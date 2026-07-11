-- Keep trip reads public while closing the legacy path that allowed every
-- signed-in visitor to make themselves a contributing member. Existing rows in
-- trip_members are deliberately untouched, and admins can continue inviting
-- people through grant_trip_member_by_email.
drop function if exists public.ensure_trip_membership(text);
