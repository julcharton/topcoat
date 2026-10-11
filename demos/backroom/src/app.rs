mod _admin;
mod login;
mod logout;

use topcoat::{
    Result,
    asset::{AssetBundle, RouterBuilderAssetExt},
    cookie::RouterBuilderCookieExt,
    font::{Font, fontsource::fontsource_font},
    router::{RouterBuilder, RouterBuilderDiscoverExt, Slot, layout, module_router},
    runtime::RouterBuilderRuntimeExt,
    session::{RouterBuilderSessionExt, SessionConfig},
    tailwind,
    view::{View, view},
};

/// The Geist font family, loaded from Fontsource and served from the asset bundle.
const GEIST: Font =
    fontsource_font!(GEIST, weight: [400, 500, 600, 700], style: Normal, host: Asset);

/// Builds the application's router.
pub fn router() -> RouterBuilder {
    // The pages and layouts of this module and its submodules, with paths derived
    // from the module tree.
    module_router!()
        // The runtime's procedures and shards, which have no place in the module tree.
        .discover()
        .assets(AssetBundle::load().unwrap())
        // Sessions carry their token in a cookie.
        .cookies()
        .sessions(SessionConfig::default())
        // Lets the browser runtime rerun pages; register it after other layers.
        .runtime()
}

/// The HTML document around every page.
#[layout]
async fn root(slot: Slot<'_>) -> Result<impl View> {
    Ok(view! {
        <!DOCTYPE html>
        <html lang="en">
            <head>
                <meta charset="utf-8">
                <meta name="viewport" content="width=device-width, initial-scale=1">
                <title>"Backroom"</title>
                <link rel="stylesheet" href=(tailwind::stylesheet!())>
                topcoat::font::link(font: GEIST)
                topcoat::runtime::script()
                topcoat::dev::script()
            </head>
            <body>(slot)</body>
        </html>
    })
}
