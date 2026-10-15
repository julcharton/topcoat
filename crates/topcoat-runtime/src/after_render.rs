use topcoat_core::context::Cx;
use topcoat_view::{
    Attribute, AttributeKey, AttributeValue, AttributeViewParts, HtmlContext, PartsWriter,
};

use crate::{EffectContext, Expr, Js};

/// Runs a browser callback once for the content carrying this attribute.
///
/// Spread the result into an element's attributes. The callback runs after
/// insertion, hydration, and local reactive updates, including on initial
/// hydration and when replacement reuses the element. It does not track signal
/// reads or run again when signals change. Attach at most one per element.
///
/// ```rust
/// use topcoat::{
///     Result,
///     context::Cx,
///     runtime::{EffectContext, after_render, expr, signal},
///     view::{View, component, view},
/// };
///
/// #[component]
/// async fn panel(cx: &Cx) -> Result<impl View> {
///     let ready = signal(cx, || false);
///     let installed = after_render(expr!(|_scope: EffectContext| ready.set(true)));
///     Ok(view! { <section (installed)>"Panel"</section> })
/// }
/// ```
///
/// Place the hook in the shard result or live emission that needs it. It does
/// not wait for a request or another region's updates. No insertion means no
/// new invocation. Failed requests and rejected stale frames create no hooks.
/// A newer request for the owner or an ancestor cancels pending hooks for its
/// old content. Disposal, replacement, or detachment also cancels them.
///
/// The context owns resources until replacement or disposal. Its callback
/// never runs on the server. It must be synchronous:
///
/// ```compile_fail
/// use topcoat::runtime::{EffectContext, after_render, expr};
/// let hook = after_render(expr!(async |_scope: EffectContext| {}));
/// ```
pub fn after_render<F>(callback: Expr<F>) -> AfterRender
where
    F: FnOnce(EffectContext),
{
    AfterRender { js: callback.js }
}

/// An element attribute that installs a callback. See [`after_render`].
pub struct AfterRender {
    js: Js,
}

impl AttributeViewParts for AfterRender {
    fn into_view_parts(self, cx: &Cx, parts: &mut PartsWriter<'_>) {
        Attribute::new("data-topcoat-after-render", self.js).into_view_parts(cx, parts);
    }
}

impl IntoIterator for AfterRender {
    type Item = (AttributeKey, AttributeValue);
    type IntoIter = std::iter::Once<Self::Item>;

    fn into_iter(self) -> Self::IntoIter {
        std::iter::once((
            AttributeKey::StaticStr {
                value: "data-topcoat-after-render",
                context: HtmlContext::AttributeKey,
            },
            AttributeValue::String {
                value: self.js.to_source(),
                context: HtmlContext::AttributeValue,
            },
        ))
    }
}
