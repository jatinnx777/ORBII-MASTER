**Subject:** anon role has INSERT/UPDATE/DELETE on public.spatial_ref_sys, cannot be revoked (owned by supabase_admin)

Project ref: henbkyjefhzmxqozlczd
Region: (fill in from your dashboard)
Plan: Free

**Issue**

On this project, PostGIS is installed into the `public` schema, so `spatial_ref_sys` is exposed through PostgREST. The `anon` role holds write privileges on it, and I cannot revoke them because the table is owned by `supabase_admin`.

**Reproduction**

A POST to `/rest/v1/spatial_ref_sys` using only the anon key returns:

```
HTTP 400
{"code":"23514","message":"new row for relation \"spatial_ref_sys\" violates check constraint \"spatial_ref_sys_srid_check\""}
```

That is a CHECK constraint rejection, not 401 or 403. The request passed authorization and was stopped only by data validation, which confirms the write privilege is live.

Confirmed from SQL:

```sql
select has_table_privilege('anon','public.spatial_ref_sys','insert'); -- true
select has_table_privilege('anon','public.spatial_ref_sys','update'); -- true
select has_table_privilege('anon','public.spatial_ref_sys','delete'); -- true
select tableowner from pg_tables where tablename='spatial_ref_sys';   -- supabase_admin
```

**What I have tried**

- `revoke insert, update, delete on public.spatial_ref_sys from anon, authenticated;` fails, must be owner
- `alter table public.spatial_ref_sys enable row level security;` fails, must be owner

**Impact**

This is a women's safety application. Every distance calculation uses `geography` on SRID 4326: service-area coverage, nearest-responder ranking, and geofence checks. Modifying the SRID 4326 row does not cause queries to error. It causes them to return wrong distances silently, which would misroute emergency responders with no failure signal anywhere in the system.

**Request**

Please either revoke `anon` write privileges on `spatial_ref_sys` for this project, or move the PostGIS extension to the `extensions` schema so it is not exposed through PostgREST, as newer projects are provisioned.

I understand the table contains only public EPSG reference data. The concern is write access, not disclosure.

**Mitigation in place**

I have a pg_cron job checking the SRID 4326 definition every five minutes and restoring it if modified. That limits exposure but does not prevent the write, and I would prefer not to rely on it.
