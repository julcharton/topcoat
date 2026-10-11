//! Demo data for a fresh database.

use toasty::Db;

use crate::features::user::{Role, User, hash_password};

/// The password of every demo account.
pub const DEMO_PASSWORD: &str = "backroom";

/// The demo accounts, one for each role.
pub const DEMO_USERS: [(&str, &str, Role); 3] = [
    ("Ada Lovelace", "ada@backroom.test", Role::Admin),
    ("Grace Hopper", "grace@backroom.test", Role::Staff),
    ("Alan Turing", "alan@backroom.test", Role::Viewer),
];

/// Fills an empty database with demo data. Does nothing if any user exists.
pub async fn seed(db: &Db) -> toasty::Result<()> {
    let mut db = db.clone();
    if User::all().first().exec(&mut db).await?.is_some() {
        return Ok(());
    }

    for (name, email, role) in DEMO_USERS {
        // Each account gets its own salt, so equal passwords still hash differently.
        let password_hash = tokio::task::spawn_blocking(|| hash_password(DEMO_PASSWORD))
            .await
            .expect("hashing a password does not panic");

        toasty::create!(User {
            name,
            email,
            password_hash: &password_hash,
            role,
        })
        .exec(&mut db)
        .await?;
    }

    Ok(())
}
