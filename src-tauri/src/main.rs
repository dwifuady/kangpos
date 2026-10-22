// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    if let Err(e) = kangpos_lib::run() {
        eprintln!("[Fatal] KangPos failed to start: {e}");
        std::process::exit(1);
    }
}
