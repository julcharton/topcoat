# Backroom

The back office of an online store, where staff sign in to manage the store. It shows how a larger Topcoat application fits together: Toasty models and migrations, password sign-in with sessions, layouts that guard pages, and a Topcoat UI shell driven by the browser runtime.

Clone the Topcoat repository:

```sh
git clone https://github.com/tokio-rs/topcoat.git
cd topcoat
```

Then run it with:

```sh
cargo topcoat dev -p backroom
```

The first start creates `data.db` next to this file and fills it with demo data. The sign-in page lists the demo accounts. Delete `data.db` to start over.

## Where to look

| Path | Contents |
| --- | --- |
| [`src/app.rs`](src/app.rs) | The router and the HTML document around every page. |
| [`src/app/login.rs`](src/app/login.rs) | Signing in, and the `require_user` guard. |
| [`src/app/_admin.rs`](src/app/_admin.rs) | The sidebar layout for signed-in staff, and the dashboard. |
| [`src/features/`](src/features) | The Toasty models and the rules around them. |
| [`src/components/`](src/components) | Components installed with `topcoat ui add`, unchanged from the registry. |
| [`toasty/`](toasty) | The migrations, applied when the app starts. |

## Changing a model

After editing a model, generate a migration from the repository root:

```sh
cargo run -p backroom -- toasty migration generate --name <name>
```

The migration is compiled into the binary and applied on the next start.

## Updating components

The components in `src/components` must match the Topcoat UI registry, which `cargo test -p backroom` checks. To pull registry changes, run `topcoat ui add <name> --overwrite` in this directory.
