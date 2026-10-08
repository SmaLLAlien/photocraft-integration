//! Host-page bridge: a page that shows PhotoCraft in an `<iframe>` opens files in it and gets
//! edited files back through `window.postMessage`.
//!
//! Every message is a plain object with `source` and `type`. Bytes travel as `Uint8Array` (or
//! `ArrayBuffer` from the host).
//!
//! Host → editor (`source: "photocraft-host"`):
//! - `{type: "open", name, bytes}`: open a file as a new document (PSD, PNG, JPEG, …);
//! - `{type: "export", id?, name?, format?}`: encode the active document (format from `name`'s
//!   extension, else `format`, else PNG) and answer with `exported` or `error`.
//!
//! Editor → host (`source: "photocraft"`):
//! - `{type: "ready"}`: the editor runs and accepts messages;
//! - `{type: "saved", name, mime, bytes}`: File › Save / Save As / Export wrote a file (sent to
//!   the host instead of a browser download while embedded);
//! - `{type: "exported", id, name, mime, bytes}` / `{type: "error", id, message}`.
//!
//! Origins: messages go to, and are accepted only from, the parent window at the origin given by
//! the `hostOrigin` query parameter (`?hostOrigin=https://app.example.com`, or `*` for any),
//! defaulting to this page's own origin (the host serves PhotoCraft from its own site).

use std::sync::{Arc, Mutex};

use js_sys::{Object, Reflect, Uint8Array};
use photocraft_ui_egui::PhotocraftApp;
use wasm_bindgen::closure::Closure;
use wasm_bindgen::{JsCast as _, JsValue};

const FROM_HOST: &str = "photocraft-host";
const FROM_EDITOR: &str = "photocraft";

/// An `export` request waiting for the next frame (it needs the app's active document).
pub struct ExportRequest {
    id: JsValue,
    name: Option<String>,
    format: Option<String>,
}

pub type Requests = Arc<Mutex<Vec<ExportRequest>>>;

fn parent() -> Option<web_sys::Window> {
    let window = web_sys::window()?;
    let parent = window.parent().ok().flatten()?;
    (!Object::is(&parent, &window)).then_some(parent)
}

/// Whether this page runs inside another page's frame.
pub fn embedded() -> bool {
    parent().is_some()
}

/// The host origin messages are sent to and accepted from.
fn host_origin() -> String {
    let window = web_sys::window();
    let query = window.as_ref().and_then(|w| w.location().search().ok()).unwrap_or_default();
    if let Ok(params) = web_sys::UrlSearchParams::new_with_str(&query)
        && let Some(origin) = params.get("hostOrigin")
        && !origin.is_empty()
    {
        return origin;
    }
    window.and_then(|w| w.location().origin().ok()).unwrap_or_else(|| "*".into())
}

fn set(obj: &Object, key: &str, value: &JsValue) {
    Reflect::set(obj, &JsValue::from_str(key), value).ok();
}

fn get_str(obj: &JsValue, key: &str) -> Option<String> {
    Reflect::get(obj, &JsValue::from_str(key)).ok()?.as_string()
}

/// Post `{source: "photocraft", type, ...fields}` to the host; bytes are transferred, not copied.
fn post(kind: &str, fields: &[(&str, JsValue)], bytes: Option<&[u8]>) -> Result<(), String> {
    let parent = parent().ok_or("not embedded")?;
    let msg = Object::new();
    set(&msg, "source", &FROM_EDITOR.into());
    set(&msg, "type", &kind.into());
    for (k, v) in fields {
        set(&msg, k, v);
    }
    let transfer = js_sys::Array::new();
    if let Some(bytes) = bytes {
        let array = Uint8Array::from(bytes);
        transfer.push(&array.buffer());
        set(&msg, "bytes", &array);
    }
    parent.post_message_with_transfer(&msg, &host_origin(), &transfer).map_err(|e| format!("{e:?}"))
}

pub fn post_ready() {
    if embedded() {
        post("ready", &[], None).ok();
    }
}

/// File › Save / Export while embedded: hand the file to the host instead of downloading it.
pub fn post_saved(path: &str, bytes: &[u8]) -> Result<(), String> {
    let name = std::path::Path::new(path).file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_else(|| "photocraft".into());
    post("saved", &[("name", name.as_str().into()), ("mime", crate::web::mime_for(&name).into())], Some(bytes))
}

/// Listen for host messages: `open` goes straight to the inbox, `export` waits in `requests`.
pub fn listen(inbox: crate::web::Inbox, requests: Requests, ctx: egui::Context) {
    let Some(window) = web_sys::window() else { return };
    let allowed = host_origin();
    let cb = Closure::<dyn FnMut(web_sys::MessageEvent)>::new(move |e: web_sys::MessageEvent| {
        let (Some(parent), Some(source)) = (parent(), e.source()) else { return };
        if !Object::is(&parent, &source) || (allowed != "*" && e.origin() != allowed) {
            return;
        }
        let data = e.data();
        if get_str(&data, "source").as_deref() != Some(FROM_HOST) {
            return;
        }
        match get_str(&data, "type").as_deref() {
            Some("open") => {
                let name = get_str(&data, "name").unwrap_or_else(|| "image.png".into());
                let Ok(bytes) = Reflect::get(&data, &JsValue::from_str("bytes")) else { return };
                if !(bytes.is_instance_of::<Uint8Array>() || bytes.is_instance_of::<js_sys::ArrayBuffer>()) {
                    log::error!("embed: `open` needs bytes as Uint8Array or ArrayBuffer");
                    return;
                }
                let bytes = Uint8Array::new(&bytes).to_vec();
                inbox.lock().unwrap_or_else(|e| e.into_inner()).push((name, bytes));
                ctx.request_repaint();
            }
            Some("export") => {
                let id = Reflect::get(&data, &JsValue::from_str("id")).unwrap_or(JsValue::NULL);
                let request = ExportRequest { id, name: get_str(&data, "name"), format: get_str(&data, "format") };
                requests.lock().unwrap_or_else(|e| e.into_inner()).push(request);
                ctx.request_repaint();
            }
            other => log::warn!("embed: unknown message type {other:?}"),
        }
    });
    if window.add_event_listener_with_callback("message", cb.as_ref().unchecked_ref()).is_ok() {
        cb.forget();
    }
}

/// Answer waiting `export` requests from the active document (called every frame).
pub fn serve(app: &PhotocraftApp, requests: &Requests) {
    let pending = std::mem::take(&mut *requests.lock().unwrap_or_else(|e| e.into_inner()));
    for request in pending {
        let id = request.id.clone();
        let result = export(app, &request).and_then(|(name, bytes)| {
            post("exported", &[("id", id.clone()), ("name", name.as_str().into()), ("mime", crate::web::mime_for(&name).into())], Some(&bytes))
        });
        if let Err(message) = result {
            log::error!("embed: export failed: {message}");
            post("error", &[("id", id), ("message", message.as_str().into())], None).ok();
        }
    }
}

fn export(app: &PhotocraftApp, request: &ExportRequest) -> Result<(String, Vec<u8>), String> {
    let st = app.session.active().ok_or("no open document")?;
    let name = match &request.name {
        Some(name) if name.contains('.') => name.clone(),
        _ => {
            let stem = request.name.clone().unwrap_or_else(|| st.doc.name.rsplit_once('.').map_or(st.doc.name.as_str(), |(a, _)| a).to_string());
            let format = request.format.as_deref().unwrap_or("png").trim_start_matches('.');
            format!("{stem}.{format}")
        }
    };
    let result = photocraft_io::export(&st.doc, &name, &photocraft_io::ExportOptions::default()).map_err(|e| e.to_string())?;
    for w in &result.warnings {
        log::warn!("embed: export {name}: {w}");
    }
    Ok((name, result.bytes))
}
