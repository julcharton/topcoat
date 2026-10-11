//! Signing in and out, and finding the signed-in user.
//!
//! Topcoat issues the session token and carries it in a cookie. The session records
//! live in the database, keyed by the token's hash.

use jiff::Timestamp;
use topcoat::{
    Result,
    context::{Cx, memoize},
    router::error::internal_server_error,
    session,
};

use super::user::User;
use crate::db::db;

/// A signed-in browser, stored under the hash of its session token.
#[derive(Debug, toasty::Model)]
pub struct Session {
    /// The SHA-256 hash of the session token. The token itself is never stored.
    #[key]
    token_hash: Vec<u8>,

    #[index]
    user_id: u64,

    #[belongs_to]
    user: toasty::Deferred<User>,

    expires_at: Timestamp,
}

/// Starts a session for `user`, replacing any session the browser had.
pub async fn sign_in(cx: &Cx, user: &User) -> Result<()> {
    let session = session::start(cx).await?;
    let expires_at = Timestamp::try_from(session.expires_at).map_err(internal_server_error)?;

    toasty::create!(Session {
        token_hash: session.token_hash.to_vec(),
        user_id: user.id,
        expires_at,
    })
    .exec(&mut db(cx))
    .await?;

    Ok(())
}

/// Ends the browser's session, if it has one.
pub async fn sign_out(cx: &Cx) -> Result<()> {
    if let Some(token_hash) = session::stop(cx).await? {
        Session::filter_by_token_hash(token_hash.to_vec())
            .delete()
            .exec(&mut db(cx))
            .await?;
    }
    Ok(())
}

/// The user signed in to this browser, or `None` without a valid session.
///
/// The result is memoized, so layouts, pages, and guards can all call it while the
/// database is queried once per request.
#[memoize(as_ref)]
pub async fn current_user(cx: &Cx) -> Result<Option<User>> {
    let Some(token_hash) = session::token_hash(cx).await? else {
        return Ok(None);
    };

    let mut db = db(cx);
    let session = Session::filter_by_token_hash(token_hash.to_vec())
        .first()
        .exec(&mut db)
        .await?;

    let Some(session) = session.filter(|session| session.expires_at > Timestamp::now()) else {
        return Ok(None);
    };

    let user = User::get_by_id(&mut db, &session.user_id).await?;
    Ok(Some(user))
}
