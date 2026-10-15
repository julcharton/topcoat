use topcoat_core::context::Cx;
use topcoat_view::{
    Attribute, AttributeKey, AttributeValue, AttributeViewParts, HtmlContext, PartsWriter,
};

use crate::{EffectContext, Expr, Js};

/// Attaches a native element lifetime and a separate reactive reconciliation.
///
/// Configuration runs without tracking signal reads after hydration. Its context
/// owns listeners and configuration resources. It returns the final native
/// teardown callback. Reconciliation runs after configuration and tracks signals
/// like [`crate::effect`]. Neither callback runs on the server.
///
/// On compatible DOM reuse, configuration runs again with current captures. Its
/// returned finalizer replaces the old finalizer without calling it. Allocate
/// configuration resources with `scope.on_cleanup`, which runs on replacement.
/// Acquire native state in reconciliation, after its finalizer is installed.
///
/// Final teardown runs once when the element is removed, replaced, or its scope
/// is disposed. Navigation ends the lifetime. Teardown must use the captured
/// element snapshot, never resolve a replacement by ID. Connections broken by
/// DOM moves end the lifetime and require a fresh element.
///
/// ```rust
/// use topcoat::{
///     context::Cx,
///     runtime::{EffectContext, element_lifecycle, expr},
///     view::*,
/// };
/// let cx = &Cx::default();
/// let lifecycle = element_lifecycle(
///     expr!(|scope: EffectContext| {
///         scope.on_cleanup(|| { /* release configuration resources */ });
///         || { /* release the native element */ }
///     }),
///     expr!(|_scope: EffectContext| { /* reconcile current signals */ }),
/// );
/// let view = view! { cx => <section (lifecycle)>"Content"</section> };
/// ```
///
/// Callbacks and the returned finalizer must be synchronous:
///
/// ```compile_fail
/// use topcoat::runtime::{EffectContext, element_lifecycle, expr};
/// let _ = element_lifecycle(
///     expr!(async |_scope: EffectContext| || {}),
///     expr!(|_scope: EffectContext| {}),
/// );
/// ```
///
/// ```compile_fail
/// use topcoat::runtime::{EffectContext, element_lifecycle, expr};
/// let _ = element_lifecycle(
///     expr!(|_scope: EffectContext| async || {}),
///     expr!(|_scope: EffectContext| {}),
/// );
/// ```
///
/// ```compile_fail
/// use topcoat::runtime::{EffectContext, element_lifecycle, expr};
/// let _ = element_lifecycle(
///     expr!(|_scope: EffectContext| || {}),
///     expr!(async |_scope: EffectContext| {}),
/// );
/// ```
pub fn element_lifecycle<Configure, Reconcile, Finalize>(
    configure: Expr<Configure>,
    reconcile: Expr<Reconcile>,
) -> ElementLifecycle
where
    Configure: FnOnce(EffectContext) -> Finalize,
    Reconcile: FnOnce(EffectContext),
    Finalize: FnOnce() + 'static,
{
    ElementLifecycle {
        configure: configure.js,
        reconcile: reconcile.js,
        attributes: Vec::new(),
    }
}

/// An element attribute installing an [`element_lifecycle`].
pub struct ElementLifecycle {
    configure: Js,
    reconcile: Js,
    attributes: Vec<&'static str>,
}

impl ElementLifecycle {
    /// Leaves this attribute's live presence and value unchanged on DOM reuse.
    ///
    /// Initial server markup still supplies defaults. Other attributes update
    /// normally. Changing the claimed set ends the native lifetime. A competing
    /// reactive binding is rejected during browser hydration.
    ///
    /// # Panics
    ///
    /// Panics if the name is empty, contains characters other than lowercase
    /// ASCII letters, digits, or hyphens, is `id`, or starts with `data-topcoat-`.
    #[must_use]
    pub fn live_attribute(mut self, name: &'static str) -> Self {
        assert!(
            !name.is_empty()
                && name
                    .bytes()
                    .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
                && name != "id"
                && !name.starts_with("data-topcoat-"),
            "invalid live attribute name"
        );
        if !self.attributes.contains(&name) {
            self.attributes.push(name);
            self.attributes.sort_unstable();
        }
        self
    }

    fn into_source(self) -> String {
        serde_json::json!({
            "configure": self.configure.to_source(),
            "reconcile": self.reconcile.to_source(),
            "attributes": self.attributes,
        })
        .to_string()
    }
}

impl AttributeViewParts for ElementLifecycle {
    fn into_view_parts(self, cx: &Cx, parts: &mut PartsWriter<'_>) {
        Attribute::new("data-topcoat-element-lifecycle", self.into_source())
            .into_view_parts(cx, parts);
    }
}

impl IntoIterator for ElementLifecycle {
    type Item = (AttributeKey, AttributeValue);
    type IntoIter = std::iter::Once<Self::Item>;

    fn into_iter(self) -> Self::IntoIter {
        std::iter::once((
            AttributeKey::StaticStr {
                value: "data-topcoat-element-lifecycle",
                context: HtmlContext::AttributeKey,
            },
            AttributeValue::String {
                value: self.into_source(),
                context: HtmlContext::AttributeValue,
            },
        ))
    }
}
