import { describe, expect, it } from 'vitest';
import { importDocument } from './index';

const collection = {
  info: { name: 'Hub', schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json' },
  auth: { type: 'bearer', bearer: [{ key: 'token', value: '{{token}}', type: 'string' }] },
  variable: [{ key: 'baseUrl', value: 'https://hub.test' }],
  item: [
    {
      name: 'Contacts',
      item: [
        {
          name: 'Get contact',
          request: {
            method: 'GET',
            header: [{ key: 'Accept', value: 'application/json' }, { key: 'X-Off', value: '1', disabled: true }],
            url: {
              raw: '{{baseUrl}}/contacts/:contactId?expand=true',
              host: ['{{baseUrl}}'],
              path: ['contacts', ':contactId'],
              query: [{ key: 'expand', value: 'true' }],
              variable: [{ key: 'contactId', value: '123' }],
            },
          },
          event: [{ listen: 'test', script: { exec: ['pm.test("ok", () => {})'] } }],
        },
        {
          name: 'Update contact',
          request: {
            method: 'PUT',
            auth: { type: 'noauth' },
            url: '{{baseUrl}}/contacts/:id',
            body: { mode: 'raw', raw: '{"name":"x"}', options: { raw: { language: 'json' } } },
          },
        },
      ],
    },
    {
      name: 'Upload',
      request: {
        method: 'POST',
        url: '{{baseUrl}}/files',
        body: {
          mode: 'formdata',
          formdata: [
            { key: 'note', value: 'hi', type: 'text' },
            { key: 'file', type: 'file', src: 'C:/tmp/a.pdf' },
          ],
        },
      },
    },
  ],
};

describe('Postman collection', () => {
  const result = importDocument(JSON.stringify(collection));

  it('creates one template per request with folder paths', () => {
    expect(result.kind).toBe('postman-collection');
    expect(result.templates.map(t => [t.folder, t.name])).toEqual([
      ['Contacts', 'Get contact'],
      ['Contacts', 'Update contact'],
      ['', 'Upload'],
    ]);
  });

  it('turns path variables into required params and splits the query', () => {
    const get = result.templates[0].request;
    expect(get.url).toBe('{{baseUrl}}/contacts/{{contactId}}');
    expect(get.query).toEqual([{ key: 'expand', value: 'true', enabled: true, description: undefined }]);
    expect(get.params).toEqual([{ name: 'contactId', default: '123', required: true, description: undefined }]);
    expect(get.headers[1].enabled).toBe(false);
  });

  it('inherits collection auth unless the request overrides it', () => {
    expect(result.templates[0].request.auth).toEqual({ type: 'bearer', token: '{{token}}' });
    expect(result.templates[1].request.auth).toEqual({ type: 'none' });
  });

  it('keeps raw json and multipart bodies', () => {
    expect(result.templates[1].request.body.type).toBe('json');
    expect(result.templates[1].request.params[0].name).toBe('id');
    expect(result.templates[2].request.body.fields).toEqual([
      { key: 'note', value: 'hi', enabled: true, kind: 'text' },
      { key: 'file', value: 'C:/tmp/a.pdf', enabled: true, kind: 'file' },
    ]);
  });

  it('imports collection variables as an environment and warns about scripts', () => {
    expect(result.environments).toEqual([
      { name: 'Hub variables', variables: [{ key: 'baseUrl', value: 'https://hub.test', enabled: true }] },
    ]);
    expect(result.warnings).toEqual([]);
    expect(result.templates[0].request.scripts).toEqual({ before: '', after: 'pm.test("ok", () => {})' });
  });
});

describe('Postman environment', () => {
  it('imports values and marks secrets', () => {
    const result = importDocument(
      JSON.stringify({
        name: 'SIT',
        values: [
          { key: 'baseUrl', value: 'https://sit.test', enabled: true },
          { key: 'token', value: 't', enabled: true, type: 'secret' },
          { key: 'old', value: 'x', enabled: false },
        ],
        _postman_variable_scope: 'environment',
      }),
    );
    expect(result.kind).toBe('postman-environment');
    expect(result.environments[0].variables).toEqual([
      { key: 'baseUrl', value: 'https://sit.test', enabled: true, secret: undefined },
      { key: 'token', value: 't', enabled: true, secret: true },
      { key: 'old', value: 'x', enabled: false, secret: undefined },
    ]);
  });
});

const openapiYaml = `
openapi: 3.0.3
info:
  title: Contacts API
servers:
  - url: https://{env}.api.test/v1
    variables:
      env:
        default: dev
security:
  - bearerAuth: []
paths:
  /contacts/{contactId}:
    parameters:
      - name: contactId
        in: path
        required: true
        schema: { type: string, example: "C-1" }
    get:
      tags: [Contacts]
      summary: Get contact
      parameters:
        - name: expand
          in: query
          schema: { type: boolean }
        - name: X-Tenant
          in: header
          required: true
          schema: { type: string }
    put:
      tags: [Contacts]
      operationId: updateContact
      requestBody:
        content:
          application/json:
            schema: { $ref: '#/components/schemas/Contact' }
  /ping:
    get:
      security: []
      responses: { '200': { description: ok } }
components:
  securitySchemes:
    bearerAuth: { type: http, scheme: bearer }
  schemas:
    Contact:
      type: object
      required: [email, name]
      properties:
        id: { type: string, readOnly: true }
        email: { type: string, format: email }
        name: { type: string, example: "Jane" }
        age: { type: integer }
        tags: { type: array, items: { type: string } }
        kind: { type: string, enum: [person, company] }
`;

describe('OpenAPI', () => {
  const result = importDocument(openapiYaml);

  it('creates templates per operation, foldered by tag', () => {
    expect(result.kind).toBe('openapi');
    expect(result.templates.map(t => [t.folder, t.name, t.request.method])).toEqual([
      ['Contacts', 'Get contact', 'GET'],
      ['Contacts', 'updateContact', 'PUT'],
      ['', 'GET /ping', 'GET'],
    ]);
  });

  it('maps path, query and header parameters', () => {
    const get = result.templates[0].request;
    expect(get.url).toBe('{{baseUrl}}/contacts/{{contactId}}');
    expect(get.params.map(p => [p.name, p.default, p.required])).toEqual([
      ['contactId', 'C-1', true],
      ['X-Tenant', '', true],
    ]);
    expect(get.query).toEqual([{ key: 'expand', value: '', enabled: false, description: undefined }]);
    expect(get.headers).toEqual([{ key: 'X-Tenant', value: '{{X-Tenant}}', enabled: true, description: undefined }]);
  });

  it('generates a JSON body and lifts required string fields into params', () => {
    const put = result.templates[1].request;
    expect(JSON.parse(put.body.raw)).toEqual({
      email: '{{email}}',
      name: '{{name}}',
      age: 0,
      tags: ['string'],
      kind: 'person',
    });
    expect(put.params.map(p => [p.name, p.default])).toEqual([
      ['contactId', 'C-1'],
      ['email', ''],
      ['name', 'Jane'],
    ]);
  });

  it('applies security and builds the environment', () => {
    expect(result.templates[0].request.auth).toEqual({ type: 'bearer', token: '{{token}}' });
    expect(result.templates[2].request.auth).toEqual({ type: 'none' });
    expect(result.environments[0]).toEqual({
      name: 'Contacts API',
      variables: [
        { key: 'baseUrl', value: 'https://dev.api.test/v1', enabled: true },
        { key: 'token', value: '', enabled: true, secret: true },
      ],
    });
  });

  it('reads Swagger 2 specs', () => {
    const swagger = importDocument(
      JSON.stringify({
        swagger: '2.0',
        info: { title: 'Old' },
        host: 'old.test',
        basePath: '/api',
        schemes: ['https'],
        paths: {
          '/items': {
            post: {
              parameters: [
                { name: 'body', in: 'body', schema: { type: 'object', required: ['sku'], properties: { sku: { type: 'string' } } } },
              ],
            },
          },
        },
      }),
    );
    expect(swagger.environments[0].variables[0].value).toBe('https://old.test/api');
    expect(swagger.templates[0].request.body.raw).toContain('{{sku}}');
  });
});

describe('detection', () => {
  it('rejects unknown documents', () => {
    expect(() => importDocument('{"hello": 1}')).toThrow(/Unrecognised file/);
    expect(() => importDocument('{nope')).toThrow(/Not valid JSON or YAML/);
  });
});

describe('OpenAPI enums become dropdown inputs', () => {
  it('maps enum parameters and required enum body fields to select inputs', () => {
    const result = importDocument(
      JSON.stringify({
        openapi: '3.0.0',
        info: { title: 'Orders' },
        servers: [{ url: 'https://orders.test' }],
        paths: {
          '/orders/{region}': {
            post: {
              parameters: [
                { name: 'region', in: 'path', required: true, schema: { type: 'string', enum: ['au', 'nz'] } },
                { name: 'status', in: 'query', required: true, schema: { type: 'string', enum: ['open', 'closed'], default: 'open' } },
              ],
              requestBody: {
                content: {
                  'application/json': {
                    schema: {
                      type: 'object',
                      required: ['channel'],
                      properties: { channel: { type: 'string', enum: ['web', 'phone'] } },
                    },
                  },
                },
              },
            },
          },
        },
      }),
    );
    const params = result.templates[0].request.params;
    expect(params).toEqual([
      { name: 'region', default: '', required: true, description: undefined, type: 'select', options: ['au', 'nz'] },
      { name: 'status', default: 'open', required: true, description: undefined, type: 'select', options: ['open', 'closed'] },
      { name: 'channel', default: '', required: true, description: undefined, type: 'select', options: ['web', 'phone'] },
    ]);
    expect(JSON.parse(result.templates[0].request.body.raw)).toEqual({ channel: '{{channel}}' });
  });

  it('reads Swagger 2 enums on the parameter itself', () => {
    const result = importDocument(
      JSON.stringify({
        swagger: '2.0',
        info: { title: 'Old' },
        host: 'old.test',
        paths: { '/items': { get: { parameters: [{ name: 'sort', in: 'query', required: true, type: 'string', enum: ['asc', 'desc'] }] } } },
      }),
    );
    expect(result.templates[0].request.params[0]).toMatchObject({ name: 'sort', type: 'select', options: ['asc', 'desc'] });
  });
});

describe('Postman scripts', () => {
  it('imports scripts with collection and folder scripts first, labelled', () => {
    const result = importDocument(
      JSON.stringify({
        info: { name: 'Hub' },
        event: [{ listen: 'prerequest', script: { exec: ["pm.variables.set('ts', Date.now());"] } }],
        item: [
          {
            name: 'Contacts',
            event: [{ listen: 'test', script: { exec: ['pm.test("2xx", () => pm.response.to.be.success);'] } }],
            item: [
              {
                name: 'Get contact',
                event: [
                  { listen: 'prerequest', script: { exec: ["const CryptoJS = require('crypto-js');"] } },
                  { listen: 'test', script: { exec: ["pm.environment.set('id', pm.response.json().id);"] } },
                ],
                request: { method: 'GET', url: 'https://x.test' },
              },
            ],
          },
        ],
      }),
    );
    expect(result.templates[0].request.scripts).toEqual({
      before: "// From collection \"Hub\"\npm.variables.set('ts', Date.now());\n\nconst CryptoJS = require('crypto-js');",
      after: "// From folder \"Contacts\"\npm.test(\"2xx\", () => pm.response.to.be.success);\n\npm.environment.set('id', pm.response.json().id);",
    });
    expect(result.warnings.join(' ')).toMatch(/require\(\)/);
  });
});

describe('Postman nested folders', () => {
  it('keeps the full ancestor path for requests in subfolders', () => {
    const result = importDocument(
      JSON.stringify({
        info: { name: 'Nested', schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json' },
        item: [
          {
            name: 'Internal',
            item: [
              {
                name: 'Documents',
                item: [{ name: 'List documents', request: { method: 'GET', url: '{{baseUrl}}/documents' } }],
              },
              {
                name: 'Payments',
                item: [{ name: 'Create payment', request: { method: 'POST', url: '{{baseUrl}}/payments' } }],
              },
            ],
          },
          {
            name: 'External',
            item: [
              {
                name: 'Offers',
                item: [{ name: 'List offers', request: { method: 'GET', url: '{{baseUrl}}/offers' } }],
              },
              {
                name: 'Products',
                item: [{ name: 'List products', request: { method: 'GET', url: '{{baseUrl}}/products' } }],
              },
            ],
          },
        ],
      }),
    );

    expect(result.templates.map(t => [t.folder, t.name])).toEqual([
      ['Internal / Documents', 'List documents'],
      ['Internal / Payments', 'Create payment'],
      ['External / Offers', 'List offers'],
      ['External / Products', 'List products'],
    ]);
  });
});
