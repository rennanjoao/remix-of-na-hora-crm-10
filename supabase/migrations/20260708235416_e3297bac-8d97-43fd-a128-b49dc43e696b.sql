-- Re-conceder EXECUTE nas funções auxiliares usadas por políticas RLS.
-- SECURITY DEFINER já protege o corpo; EXECUTE só controla quem pode invocar.
GRANT EXECUTE ON FUNCTION public.has_role(uuid, app_role) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.get_profile_id(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_user_role(uuid) TO authenticated;

-- Restringir visualização de profiles (remover USING(true))
DROP POLICY IF EXISTS "Users can view all profiles" ON public.profiles;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='profiles' AND policyname='Users view own profile'
  ) THEN
    CREATE POLICY "Users view own profile"
      ON public.profiles FOR SELECT TO authenticated
      USING (auth.uid() = user_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='profiles' AND policyname='Admins and managers view all profiles'
  ) THEN
    CREATE POLICY "Admins and managers view all profiles"
      ON public.profiles FOR SELECT TO authenticated
      USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'gerente'));
  END IF;
END $$;