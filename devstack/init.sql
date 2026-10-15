-- Minimal imitation of a hosted Supabase database, for local tests only.
-- Roles, schemas and default privileges match what Supabase sets up.

create role anon nologin noinherit;
create role authenticated nologin noinherit;
create role service_role nologin noinherit bypassrls;
create role authenticator login password 'devpass' noinherit;
grant anon, authenticated, service_role to authenticator;

create role supabase_auth_admin login password 'devpass' createrole;
create schema auth authorization supabase_auth_admin;
alter role supabase_auth_admin set search_path = 'auth';
grant usage on schema auth to anon, authenticated, service_role;

create schema if not exists extensions;
grant usage on schema extensions to anon, authenticated, service_role;

grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
