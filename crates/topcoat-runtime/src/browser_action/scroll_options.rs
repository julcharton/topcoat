use ref_cast::RefCast;
use serde::Serialize;

use crate::{impl_surrogate, impl_surrogate_ref};

/// Alignment within the scrolling ancestor's block or inline axis.
#[derive(Debug, Clone, Copy, Default, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ScrollAlignment {
    /// Align the element's start edge.
    #[default]
    Start,
    /// Center the element.
    Center,
    /// Align the element's end edge.
    End,
    /// Scroll the minimum distance needed to reveal the element.
    Nearest,
}

/// How a native scroll moves to its destination.
#[derive(Debug, Clone, Copy, Default, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ScrollBehavior {
    /// Follow the scrolling ancestor's CSS `scroll-behavior`.
    #[default]
    Auto,
    /// Move immediately.
    Instant,
    /// Animate using the browser's native smooth scrolling.
    Smooth,
}

/// Options for [`HtmlElement::scroll_into_view`](crate::HtmlElement::scroll_into_view).
///
/// Construct these outside `expr!` and capture them in a handler. Defaults match
/// the browser: block start, inline nearest, and automatic behavior. Scrolling
/// follows native layout, including writing modes, scroll margins, and padding.
/// Completion of a smooth scroll is not awaited.
#[derive(Debug, Clone, Copy, Serialize)]
#[serde(tag = "t")]
pub struct ScrollIntoViewOptions {
    /// Alignment along the block axis.
    pub block: ScrollAlignment,
    /// Alignment along the inline axis.
    pub inline: ScrollAlignment,
    /// Whether scrolling is immediate, smooth, or controlled by CSS.
    pub behavior: ScrollBehavior,
}

impl Default for ScrollIntoViewOptions {
    fn default() -> Self {
        Self {
            block: ScrollAlignment::Start,
            inline: ScrollAlignment::Nearest,
            behavior: ScrollBehavior::Auto,
        }
    }
}

/// Captured scroll options in a runtime expression.
#[derive(Debug, Clone, Copy, Serialize, RefCast)]
#[repr(transparent)]
#[serde(transparent)]
pub struct ScrollIntoViewOptionsSurrogate(ScrollIntoViewOptions);

impl ScrollIntoViewOptionsSurrogate {
    pub(crate) fn new(value: ScrollIntoViewOptions) -> Self {
        Self(value)
    }
}

impl_surrogate!(ScrollIntoViewOptions, ScrollIntoViewOptionsSurrogate);
impl_surrogate_ref!(ScrollIntoViewOptions, ScrollIntoViewOptionsSurrogate);
