// HTTP execution. The frontend sends a fully resolved request (variables,
// auth and URL-encoded bodies are already applied); this module only puts it
// on the wire, measures it and hands back the response.

use base64::Engine;
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::time::{Duration, Instant};
use tokio::task::AbortHandle;

/// Bodies larger than this are cut off (the response says `truncated`).
const MAX_BODY_BYTES: usize = 50 * 1024 * 1024;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SendRequestInput {
    /// Caller-chosen id, used to cancel the request.
    pub request_id: String,
    pub method: String,
    pub url: String,
    #[serde(default)]
    pub headers: Vec<(String, String)>,
    #[serde(default)]
    pub body: RequestBody,
    #[serde(default)]
    pub options: SendOptions,
}

#[derive(Debug, Deserialize, Default)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum RequestBody {
    #[default]
    None,
    Raw {
        content: String,
    },
    Multipart {
        fields: Vec<MultipartField>,
    },
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MultipartField {
    pub name: String,
    pub value: String,
    /// "text" or "file" (value is then a local path).
    pub kind: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct SendOptions {
    pub timeout_ms: u64,
    pub follow_redirects: bool,
    pub verify_tls: bool,
}

impl Default for SendOptions {
    fn default() -> Self {
        Self {
            timeout_ms: 30_000,
            follow_redirects: true,
            verify_tls: true,
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HttpResponse {
    pub status: u16,
    pub status_text: String,
    pub http_version: String,
    pub headers: Vec<(String, String)>,
    /// UTF-8 body, when the body decodes as text.
    pub body: Option<String>,
    /// Base64 body, when it does not.
    pub body_base64: Option<String>,
    pub content_type: Option<String>,
    pub size_bytes: usize,
    pub duration_ms: u128,
    pub truncated: bool,
    pub final_url: String,
}

#[derive(Default)]
pub struct HttpState {
    in_flight: Mutex<HashMap<String, AbortHandle>>,
}

impl HttpState {
    pub fn cancel(&self, request_id: &str) -> bool {
        match self.in_flight.lock().remove(request_id) {
            Some(handle) => {
                handle.abort();
                true
            }
            None => false,
        }
    }
}

pub async fn send(state: &HttpState, input: SendRequestInput) -> Result<HttpResponse, String> {
    let request_id = input.request_id.clone();
    let task = tokio::spawn(execute(input));
    state
        .in_flight
        .lock()
        .insert(request_id.clone(), task.abort_handle());
    let result = task.await;
    state.in_flight.lock().remove(&request_id);
    match result {
        Ok(inner) => inner,
        Err(e) if e.is_cancelled() => Err("Request cancelled".into()),
        Err(e) => Err(format!("Request task failed: {e}")),
    }
}

fn build_client(options: &SendOptions) -> Result<reqwest::Client, String> {
    let redirect = if options.follow_redirects {
        reqwest::redirect::Policy::limited(10)
    } else {
        reqwest::redirect::Policy::none()
    };
    let mut builder = reqwest::Client::builder()
        .redirect(redirect)
        .danger_accept_invalid_certs(!options.verify_tls)
        .user_agent(concat!("KangPos/", env!("CARGO_PKG_VERSION")));
    if options.timeout_ms > 0 {
        builder = builder.timeout(Duration::from_millis(options.timeout_ms));
    }
    builder.build().map_err(|e| e.to_string())
}

async fn execute(input: SendRequestInput) -> Result<HttpResponse, String> {
    let client = build_client(&input.options)?;
    let method = reqwest::Method::from_bytes(input.method.trim().to_uppercase().as_bytes())
        .map_err(|_| format!("Invalid HTTP method: {}", input.method))?;
    let url = reqwest::Url::parse(input.url.trim()).map_err(|e| format!("Invalid URL: {e}"))?;

    let mut request = client.request(method, url);
    for (key, value) in &input.headers {
        if key.trim().is_empty() {
            continue;
        }
        request = request.header(key.trim(), value);
    }
    request = match input.body {
        RequestBody::None => request,
        RequestBody::Raw { content } => request.body(content),
        RequestBody::Multipart { fields } => request.multipart(build_multipart(fields)?),
    };

    let started = Instant::now();
    let response = request.send().await.map_err(describe_error)?;

    let status = response.status();
    let http_version = format!("{:?}", response.version());
    let final_url = response.url().to_string();
    let headers: Vec<(String, String)> = response
        .headers()
        .iter()
        .map(|(k, v)| {
            (
                k.to_string(),
                String::from_utf8_lossy(v.as_bytes()).into_owned(),
            )
        })
        .collect();
    let content_type = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .map(str::to_string);

    let (bytes, truncated) = read_body(response).await?;
    let duration_ms = started.elapsed().as_millis();
    let size_bytes = bytes.len();

    let (body, body_base64) = match String::from_utf8(bytes) {
        Ok(text) => (Some(text), None),
        Err(e) => (
            None,
            Some(base64::engine::general_purpose::STANDARD.encode(e.into_bytes())),
        ),
    };

    Ok(HttpResponse {
        status: status.as_u16(),
        status_text: status.canonical_reason().unwrap_or("").to_string(),
        http_version,
        headers,
        body,
        body_base64,
        content_type,
        size_bytes,
        duration_ms,
        truncated,
        final_url,
    })
}

async fn read_body(mut response: reqwest::Response) -> Result<(Vec<u8>, bool), String> {
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(describe_error)? {
        if bytes.len() + chunk.len() > MAX_BODY_BYTES {
            let room = MAX_BODY_BYTES - bytes.len();
            bytes.extend_from_slice(&chunk[..room]);
            return Ok((bytes, true));
        }
        bytes.extend_from_slice(&chunk);
    }
    Ok((bytes, false))
}

fn build_multipart(fields: Vec<MultipartField>) -> Result<reqwest::multipart::Form, String> {
    let mut form = reqwest::multipart::Form::new();
    for field in fields {
        if field.kind == "file" {
            let path = std::path::Path::new(&field.value);
            let data = std::fs::read(path)
                .map_err(|e| format!("Cannot read file for '{}': {e}", field.name))?;
            let file_name = path
                .file_name()
                .map(|n| n.to_string_lossy().into_owned())
                .unwrap_or_else(|| "file".into());
            form = form.part(
                field.name,
                reqwest::multipart::Part::bytes(data).file_name(file_name),
            );
        } else {
            form = form.text(field.name, field.value);
        }
    }
    Ok(form)
}

/// Turn reqwest's nested error chain into one readable line.
fn describe_error(error: reqwest::Error) -> String {
    let kind = if error.is_timeout() {
        "Request timed out"
    } else if error.is_connect() {
        "Could not connect"
    } else if error.is_redirect() {
        "Too many redirects"
    } else if error.is_body() || error.is_decode() {
        "Failed to read response"
    } else {
        "Request failed"
    };
    let mut detail = String::new();
    let mut source: Option<&dyn std::error::Error> = std::error::Error::source(&error);
    while let Some(s) = source {
        detail = s.to_string();
        source = s.source();
    }
    if detail.is_empty() {
        format!("{kind}: {error}")
    } else {
        format!("{kind}: {detail}")
    }
}

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::expect_used)]
mod tests {
    use super::*;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    /// One-shot HTTP server that echoes the request line and body length.
    async fn serve_once(body: &'static [u8]) -> (String, tokio::task::JoinHandle<String>) {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let handle = tokio::spawn(async move {
            let (mut socket, _) = listener.accept().await.unwrap();
            let mut buf = vec![0u8; 8192];
            let n = socket.read(&mut buf).await.unwrap();
            let request = String::from_utf8_lossy(&buf[..n]).into_owned();
            let head = format!(
                "HTTP/1.1 201 Created\r\nContent-Type: application/json\r\nContent-Length: {}\r\nX-Test: yes\r\nConnection: close\r\n\r\n",
                body.len()
            );
            socket.write_all(head.as_bytes()).await.unwrap();
            socket.write_all(body).await.unwrap();
            request
        });
        (format!("http://{addr}"), handle)
    }

    #[tokio::test]
    async fn sends_method_headers_and_body() {
        let (base, server) = serve_once(br#"{"ok":true}"#).await;
        let state = HttpState::default();
        let response = send(
            &state,
            SendRequestInput {
                request_id: "r1".into(),
                method: "post".into(),
                url: format!("{base}/contacts?x=1"),
                headers: vec![("X-Custom".into(), "abc".into())],
                body: RequestBody::Raw {
                    content: "{\"name\":\"a\"}".into(),
                },
                options: SendOptions::default(),
            },
        )
        .await
        .unwrap();

        assert_eq!(response.status, 201);
        assert_eq!(response.body.as_deref(), Some(r#"{"ok":true}"#));
        assert_eq!(response.content_type.as_deref(), Some("application/json"));
        assert!(response
            .headers
            .iter()
            .any(|(k, v)| k == "x-test" && v == "yes"));

        let raw = server.await.unwrap();
        assert!(raw.starts_with("POST /contacts?x=1 HTTP/1.1"));
        assert!(raw.to_lowercase().contains("x-custom: abc"));
        assert!(raw.ends_with("{\"name\":\"a\"}"));
    }

    #[tokio::test]
    async fn binary_body_comes_back_as_base64() {
        let (base, _server) = serve_once(&[0xff, 0xfe, 0x00]).await;
        let state = HttpState::default();
        let response = send(
            &state,
            SendRequestInput {
                request_id: "r2".into(),
                method: "GET".into(),
                url: base,
                headers: vec![],
                body: RequestBody::None,
                options: SendOptions::default(),
            },
        )
        .await
        .unwrap();
        assert_eq!(response.body, None);
        assert_eq!(response.body_base64.as_deref(), Some("//4A"));
    }

    #[tokio::test]
    async fn invalid_url_is_reported() {
        let state = HttpState::default();
        let err = send(
            &state,
            SendRequestInput {
                request_id: "r3".into(),
                method: "GET".into(),
                url: "not a url".into(),
                headers: vec![],
                body: RequestBody::None,
                options: SendOptions::default(),
            },
        )
        .await
        .unwrap_err();
        assert!(err.starts_with("Invalid URL"));
    }

    /// Live check (needs network): HTTPS works with our client. Behind a
    /// TLS-inspecting VPN this only passes because the Windows store is trusted.
    /// Run with `cargo test -- --ignored live_https`.
    #[tokio::test]
    #[ignore]
    async fn live_https_with_os_roots() {
        let state = HttpState::default();
        let response = send(
            &state,
            SendRequestInput {
                request_id: "live".into(),
                method: "GET".into(),
                url: "https://jsonplaceholder.typicode.com/posts/1".into(),
                headers: vec![],
                body: RequestBody::None,
                options: SendOptions::default(),
            },
        )
        .await
        .unwrap();
        assert_eq!(response.status, 200);
    }

    /// Diagnostic: the same request with only the bundled (webpki) roots.
    /// Fails with UnknownIssuer when a VPN intercepts TLS, which is the case
    /// the Windows store fixes. Prints the outcome instead of asserting.
    #[tokio::test]
    #[ignore]
    async fn live_https_bundled_roots_only() {
        let client = reqwest::Client::builder()
            .tls_built_in_native_certs(false)
            .build()
            .unwrap();
        match client
            .get("https://jsonplaceholder.typicode.com/posts/1")
            .send()
            .await
        {
            Ok(r) => println!(
                "bundled roots only: OK ({}), traffic is not intercepted",
                r.status()
            ),
            Err(e) => println!("bundled roots only: FAILED: {}", describe_error(e)),
        }
    }
}
