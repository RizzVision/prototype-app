# React + Vite

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the ESLint configuration

If you are developing a production application, we recommend using TypeScript with type-aware lint rules enabled. Check out the [TS template](https://github.com/vitejs/vite/tree/main/packages/create-vite/template-react-ts) for information on how to integrate TypeScript and [`typescript-eslint`](https://typescript-eslint.io) in your project.

## Supabase Auth Setup (Email + Google OAuth)

The app uses Supabase for authentication and requires both frontend and backend environment variables.

1. Copy `.env.example` to `.env` and fill values.
2. In Supabase Dashboard, go to Authentication > Providers > Google and enable Google login.
3. Add authorized redirect URLs in Supabase:
   - `http://localhost:5173/auth/callback` for local development
   - `https://<your-domain>/auth/callback` for production
4. Set Authentication > URL Configuration > Site URL to your app domain.

### Required frontend env vars

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `VITE_SUPABASE_OAUTH_REDIRECT_URL`

### Required backend env vars

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_AUTH_TIMEOUT_SECONDS` (optional, default `5`)

The `/detect` endpoint now requires `Authorization: Bearer <supabase_access_token>`.

## Account Linking Notes

Google sign-in auto-creates users on first login. If a user signs in with Google using the same email as an existing email/password account, Supabase identity-linking behavior depends on your project auth settings.
