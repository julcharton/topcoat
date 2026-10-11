//! Staff accounts and their passwords.

use argon2::{
    Argon2,
    password_hash::{PasswordHasher, PasswordVerifier, phc::PasswordHash},
};
use topcoat::{Result, context::Cx, router::error::internal_server_error};

use crate::db::db;

/// A member of staff who can sign in to the back office.
#[derive(Debug, toasty::Model)]
pub struct User {
    #[key]
    #[auto]
    pub id: u64,

    pub name: String,

    #[unique]
    pub email: String,

    /// The Argon2 hash of the password, as a PHC string.
    password_hash: String,

    pub role: Role,
}

impl User {
    /// Returns the user with this email address and password, or `None` if either
    /// does not match.
    pub async fn authenticate(cx: &Cx, email: &str, password: String) -> Result<Option<User>> {
        let user = User::filter_by_email(email.trim().to_lowercase())
            .first()
            .exec(&mut db(cx))
            .await?;

        let Some(user) = user else {
            return Ok(None);
        };

        let password_hash = user.password_hash.clone();
        let matches =
            tokio::task::spawn_blocking(move || verify_password(&password, &password_hash))
                .await
                .map_err(internal_server_error)?;

        Ok(matches.then_some(user))
    }

    /// The initials of the user's name, for avatars.
    pub fn initials(&self) -> String {
        self.name
            .split_whitespace()
            .filter_map(|word| word.chars().next())
            .take(2)
            .collect()
    }
}

/// What a user may do in the back office.
#[derive(Debug, Clone, Copy, PartialEq, Eq, toasty::Embed)]
pub enum Role {
    /// Manages the store and its staff.
    Admin,
    /// Handles orders, products, and customers.
    Staff,
    /// Reads everything but changes nothing.
    Viewer,
}

impl Role {
    /// The role's name, for display.
    pub fn label(self) -> &'static str {
        match self {
            Self::Admin => "Admin",
            Self::Staff => "Staff",
            Self::Viewer => "Viewer",
        }
    }
}

/// Hashes a password with a random salt.
///
/// Hashing is deliberately slow. Call it outside the async runtime, for example
/// with [`tokio::task::spawn_blocking`].
pub fn hash_password(password: &str) -> String {
    Argon2::default()
        .hash_password(password.as_bytes())
        .expect("hashing a password with the default parameters succeeds")
        .to_string()
}

/// Checks a password against a hash from [`hash_password`].
fn verify_password(password: &str, password_hash: &str) -> bool {
    PasswordHash::new(password_hash).is_ok_and(|hash| {
        Argon2::default()
            .verify_password(password.as_bytes(), &hash)
            .is_ok()
    })
}
