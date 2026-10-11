mod app;
// Installed from the Topcoat UI registry and kept unchanged, so parts go unused.
#[allow(dead_code)]
mod components;
mod db;
mod features;
mod seed;

#[tokio::main]
async fn main() {
    let db = db::connect().await.unwrap();

    // `cargo run -p backroom -- toasty migration <command>` manages the database schema.
    let mut args = std::env::args().skip(1).peekable();
    if args.peek().is_some_and(|arg| arg == "toasty") {
        if let Err(error) = db::cli(db).parse_from(args).await {
            eprintln!("{error:#}");
            std::process::exit(1);
        }
        return;
    }

    // The demo sets up its own database, so it runs without any manual steps.
    db::migrate(&db).await.unwrap();
    seed::seed(&db).await.unwrap();

    topcoat::start(app::router().app_context(db).build())
        .await
        .unwrap();
}
