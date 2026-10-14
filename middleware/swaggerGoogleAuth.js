const express = require('express');
const session = require('express-session');
const { Passport } = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;

const SESSION_MAX_AGE_MS = 8 * 60 * 60 * 1000;

function createSwaggerGoogleAuth() {
  const router = express.Router();
  const passport = new Passport();
  const allowedEmails = new Set(
    (process.env.SWAGGER_ALLOWED_EMAILS || '')
      .split(',')
      .map((email) => email.trim().toLowerCase())
      .filter((email) => email.endsWith('@gmail.com'))
  );
  const missingSettings = [
    ['GOOGLE_CLIENT_ID', process.env.GOOGLE_CLIENT_ID],
    ['GOOGLE_CLIENT_SECRET', process.env.GOOGLE_CLIENT_SECRET],
    ['GOOGLE_CALLBACK_URL', process.env.GOOGLE_CALLBACK_URL],
    ['SWAGGER_SESSION_SECRET', process.env.SWAGGER_SESSION_SECRET],
    ['SWAGGER_ALLOWED_EMAILS', allowedEmails.size > 0 ? 'configured' : '']
  ].filter(([, value]) => !value).map(([name]) => name);
  const isConfigured =
    missingSettings.length === 0 &&
    process.env.SWAGGER_SESSION_SECRET.length >= 32;

  if (missingSettings.length > 0) {
    console.warn(`Swagger Google sign-in is not configured. Missing: ${missingSettings.join(', ')}`);
  } else if (!isConfigured) {
    console.warn('Swagger Google sign-in is not configured. SWAGGER_SESSION_SECRET must be at least 32 characters.');
  }

  const sessionMiddleware = isConfigured
    ? [
        session({
          name: 'swagger.sid',
          secret: process.env.SWAGGER_SESSION_SECRET,
          resave: false,
          saveUninitialized: false,
          cookie: {
            httpOnly: true,
            maxAge: SESSION_MAX_AGE_MS,
            sameSite: 'lax',
            secure: 'auto'
          }
        }),
        passport.initialize(),
        passport.session()
      ]
    : [];

  if (isConfigured) {
    passport.use(new GoogleStrategy({
      clientID: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      callbackURL: process.env.GOOGLE_CALLBACK_URL,
      store: true
    }, (accessToken, refreshToken, profile, done) => {
      const email = profile.emails?.[0]?.value?.toLowerCase();
      const emailVerified = profile._json.email_verified === true;

      if (!email || !emailVerified || !allowedEmails.has(email)) {
        return done(null, false);
      }

      return done(null, { email });
    }));

    passport.serializeUser((user, done) => done(null, user.email));
    passport.deserializeUser((email, done) => done(null, { email }));

    router.get('/google', passport.authenticate('google', {
      scope: ['email', 'profile']
    }));

    router.get('/google/callback', passport.authenticate('google', {
      failureRedirect: '/api-docs/login?error=access_denied'
    }), (req, res) => res.redirect('/api-docs/'));

    router.get('/logout', (req, res, next) => {
      req.logout((logoutError) => {
        if (logoutError) {
          return next(logoutError);
        }

        req.session.destroy((sessionError) => {
          if (sessionError) {
            return next(sessionError);
          }

          res.clearCookie('swagger.sid');
          return res.redirect('/api-docs/login');
        });
      });
    });
  } else {
    router.use((req, res) => res.status(503).send(
      'Swagger Google sign-in is not configured. Set the required server environment variables.'
    ));
  }

  function loginPage(req, res) {
    if (!isConfigured) {
      return res.status(503).send(
        'Swagger Google sign-in is not configured. Set the required server environment variables.'
      );
    }

    const accessDenied = req.query.error === 'access_denied';
    return res.status(accessDenied ? 403 : 200).type('html').send(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Sign in to API documentation</title>
  </head>
  <body>
    <main>
      <h1>API documentation</h1>
      <p>${accessDenied ? 'This Google account is not on the Swagger access list.' : 'Sign in with an approved Gmail account to continue.'}</p>
      <a href="/auth/google">Continue with Google</a>
    </main>
  </body>
</html>`);
  }

  function requireAuth(req, res, next) {
    if (!isConfigured) {
      return res.status(503).send(
        'Swagger Google sign-in is not configured. Set the required server environment variables.'
      );
    }

    if (req.isAuthenticated()) {
      return next();
    }

    return res.redirect('/api-docs/login');
  }

  return { loginPage, requireAuth, router, sessionMiddleware };
}

module.exports = createSwaggerGoogleAuth;
