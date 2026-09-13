CREATE OR REPLACE FUNCTION public.delete_pending_invitation(p_user_id uuid, p_email text)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE candidate auth.users%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS (
    SELECT 1 FROM auth.users WHERE id=auth.uid() AND lower(email)='inna_odincova@mail.ru' AND email_confirmed_at IS NOT NULL
  ) THEN RAISE EXCEPTION 'Доступ только у владельца' USING ERRCODE='42501'; END IF;
  IF p_user_id=auth.uid() THEN RAISE EXCEPTION 'Нельзя удалить владельца' USING ERRCODE='P0001'; END IF;
  SELECT * INTO candidate FROM auth.users WHERE id=p_user_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Пользователь уже удалён. Обновите список.' USING ERRCODE='P0001'; END IF;
  IF lower(candidate.email) IS DISTINCT FROM lower(trim(p_email))
    OR candidate.invited_at IS NULL OR candidate.email_confirmed_at IS NOT NULL
    OR candidate.confirmed_at IS NOT NULL OR candidate.last_sign_in_at IS NOT NULL
    OR EXISTS(SELECT 1 FROM auth.sessions WHERE user_id=p_user_id)
    OR EXISTS(SELECT 1 FROM public.user_app_data WHERE user_id=p_user_id)
  THEN RAISE EXCEPTION 'Пользователь уже активировал доступ или имеет данные. Удаление отменено.' USING ERRCODE='P0001'; END IF;
  DELETE FROM auth.users WHERE id=p_user_id;
  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.delete_pending_invitation(uuid,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_pending_invitation(uuid,text) TO authenticated;
COMMENT ON FUNCTION public.delete_pending_invitation(uuid,text) IS 'Owner-only deletion of an unused invitation. Locks the auth user while checking activation, sessions and data; active accounts are retained.';
