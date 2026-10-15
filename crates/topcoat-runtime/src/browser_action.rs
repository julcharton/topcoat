mod error;
mod scroll_options;

pub use error::*;
pub use scroll_options::*;

use crate::{
    BoolSurrogate, DialogElement, EventTarget, HtmlElement, InputElement, ResultSurrogate,
    SelectElement, StrSurrogate, TextAreaElement,
};

macro_rules! html_actions {
    ($($element:ty),+ $(,)?) => {$(
        impl $element {
            /// Requests native focus and reports whether this element received it.
            ///
            /// Pass `true` to prevent scrolling. Disabled, inert, or otherwise
            /// unfocusable elements can return `Ok(false)`. Focus is observed
            /// immediately after the native call, not guaranteed to remain there.
            /// A disconnected handle returns an error.
            ///
            /// # Panics
            ///
            /// Browser-only. Server execution is rejected.
            #[must_use]
            pub fn focus(&self, _prevent_scroll: BoolSurrogate) -> ResultSurrogate<bool, BrowserActionError> {
                panic!("browser actions cannot run on the server");
            }

            /// Scrolls native ancestors to reveal this element using `options`.
            ///
            /// Success means the request was accepted. Hidden elements may not
            /// scroll, and smooth scrolling may finish later. A disconnected
            /// handle returns an error.
            ///
            /// # Panics
            ///
            /// Browser-only. Server execution is rejected.
            #[must_use]
            pub fn scroll_into_view(&self, _options: ScrollIntoViewOptionsSurrogate) -> ResultSurrogate<(), BrowserActionError> {
                panic!("browser actions cannot run on the server");
            }

            /// Whether `target` is this node or a descendant in the DOM tree.
            ///
            /// Null and non-Node event targets return `Ok(false)`. This does not
            /// use the composed event path across shadow roots. A disconnected
            /// receiver returns an error. For an optional related target, unwrap
            /// it only when present, and treat absence as outside the element.
            ///
            /// # Panics
            ///
            /// Browser-only. Server execution is rejected.
            #[must_use]
            pub fn contains(&self, _target: EventTarget) -> ResultSurrogate<bool, BrowserActionError> {
                panic!("browser actions cannot run on the server");
            }

            /// Shows a native popover and returns its resulting open state.
            ///
            /// Requires a `popover` attribute. A canceled `beforetoggle` event
            /// can leave it closed and return `Ok(false)`. Already open is a
            /// successful no-op. Native toggle events and auto-popover behavior
            /// are preserved. A disconnected handle returns an error.
            ///
            /// # Panics
            ///
            /// Browser-only. Server execution is rejected.
            #[must_use]
            pub fn show_popover(&self) -> ResultSurrogate<bool, BrowserActionError> {
                panic!("browser actions cannot run on the server");
            }

            /// Hides a native popover and returns its resulting open state.
            ///
            /// Requires a `popover` attribute. Normally returns `Ok(false)`;
            /// native event handlers can affect the final state. Already closed
            /// is a successful no-op. A disconnected handle returns an error.
            ///
            /// # Panics
            ///
            /// Browser-only. Server execution is rejected.
            #[must_use]
            pub fn hide_popover(&self) -> ResultSurrogate<bool, BrowserActionError> {
                panic!("browser actions cannot run on the server");
            }
        }
    )+};
}

html_actions!(
    HtmlElement,
    InputElement,
    SelectElement,
    TextAreaElement,
    DialogElement
);

macro_rules! form_control_actions {
    ($($element:ty),+ $(,)?) => {$(
        impl $element {
            /// Sets the native custom validity message. An empty string clears it.
            ///
            /// This does not display validation UI. Disabled and other controls
            /// barred from validation retain native constraint-validation rules.
            /// A disconnected handle returns an error.
            ///
            /// # Panics
            ///
            /// Browser-only. Server execution is rejected.
            #[must_use]
            pub fn set_custom_validity(&self, _message: &StrSurrogate) -> ResultSurrogate<(), BrowserActionError> {
                panic!("browser actions cannot run on the server");
            }

            /// Reports native validity, including the browser's validation UI.
            ///
            /// Returns `Ok(false)` for an invalid control even when its `invalid`
            /// event is canceled. Controls barred from validation return
            /// `Ok(true)`. A disconnected handle returns an error.
            ///
            /// # Panics
            ///
            /// Browser-only. Server execution is rejected.
            #[must_use]
            pub fn report_validity(&self) -> ResultSurrogate<bool, BrowserActionError> {
                panic!("browser actions cannot run on the server");
            }

            /// The current owning form as an event target, or `None` if unowned.
            ///
            /// Honors the native `form` attribute as well as ancestor forms. Use
            /// the target to attach a scoped reset listener. The target is a
            /// browser-only snapshot and cannot be serialized. A disconnected
            /// control returns an error.
            ///
            /// # Panics
            ///
            /// Browser-only. Server execution is rejected.
            #[must_use]
            pub fn form_target(&self) -> ResultSurrogate<Option<EventTarget>, BrowserActionError> {
                panic!("browser actions cannot run on the server");
            }
        }
    )+};
}

form_control_actions!(InputElement, SelectElement, TextAreaElement);

impl DialogElement {
    /// Shows this dialog modally and reports whether it is open afterward.
    ///
    /// Native focus, inertness, and cancel/close events are preserved. Canceling
    /// opening can return `Ok(false)`. Already modal is a successful no-op;
    /// already open non-modally returns an invalid-state error. A disconnected
    /// handle returns an error.
    ///
    /// # Panics
    ///
    /// Browser-only. Server execution is rejected.
    #[must_use]
    pub fn show_modal(&self) -> ResultSurrogate<bool, BrowserActionError> {
        panic!("browser actions cannot run on the server");
    }

    /// Closes this dialog with a native return value.
    ///
    /// An already closed dialog is a successful no-op and keeps its return
    /// value. Native close events and focus restoration are preserved. This
    /// does not dispatch `cancel`. A disconnected handle returns an error.
    ///
    /// # Panics
    ///
    /// Browser-only. Server execution is rejected.
    #[must_use]
    pub fn close(&self, _return_value: &StrSurrogate) -> ResultSurrogate<(), BrowserActionError> {
        panic!("browser actions cannot run on the server");
    }
}
