use crate::{BoolSurrogate, Surrogate, Surrogated};

/// A browser action could not run on its resolved element.
///
/// Reference lookup reports missing and wrong-type elements separately through
/// [`ElementRefError`](crate::ElementRefError). Action errors describe a detached
/// handle, an unavailable native operation, or a rejected native state.
#[derive(Debug)]
pub struct BrowserActionError {
    browser_only: std::convert::Infallible,
}

impl BrowserActionError {
    /// Whether the resolved node is no longer connected to a document.
    #[must_use]
    pub fn is_disconnected(&self) -> BoolSurrogate {
        match self.browser_only {}
    }

    /// Whether the browser does not support this operation on the element.
    #[must_use]
    pub fn is_unsupported(&self) -> BoolSurrogate {
        match self.browser_only {}
    }

    /// Whether the native operation rejected the element's current state.
    ///
    /// Examples include a missing `popover` attribute or a dialog already open
    /// non-modally. Canceling a native event does not produce this error.
    #[must_use]
    pub fn is_invalid_state(&self) -> BoolSurrogate {
        match self.browser_only {}
    }
}

impl Surrogated for BrowserActionError {
    type Surrogate = Self;

    fn into_surrogate(self) -> Self {
        self
    }
}

impl Surrogate for BrowserActionError {
    type Real = Self;

    fn into_real(self) -> Self {
        self
    }
}
