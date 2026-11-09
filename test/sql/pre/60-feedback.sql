-- Feedback tables matching reads (CI only; feedback owns them).

-- Shared types: created only when missing (other modules use them too).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'feedback_action') THEN
    CREATE TYPE public.feedback_action AS ENUM ('viewed', 'saved', 'unsaved', 'applied', 'applied_external', 'dismissed', 'hidden', 'hidden_company');
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS public.saved_jobs (
    user_id uuid NOT NULL,
    job_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.saved_jobs FORCE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.user_job_feedback (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    job_id uuid NOT NULL,
    company_id uuid,
    action public.feedback_action NOT NULL,
    reason text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT user_job_feedback_reason_check CHECK ((reason = ANY (ARRAY['salary'::text, 'format'::text, 'timezone'::text, 'company'::text, 'role'::text, 'other'::text])))
);

ALTER TABLE ONLY public.user_job_feedback FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'saved_jobs_pkey') THEN
    ALTER TABLE public.saved_jobs ADD CONSTRAINT saved_jobs_pkey PRIMARY KEY (user_id, job_id);
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_job_feedback_pkey') THEN
    ALTER TABLE public.user_job_feedback ADD CONSTRAINT user_job_feedback_pkey PRIMARY KEY (id);
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS user_job_feedback_company_idx ON public.user_job_feedback USING btree (company_id, action, created_at DESC);

CREATE INDEX IF NOT EXISTS user_job_feedback_user_action_idx ON public.user_job_feedback USING btree (user_id, action, created_at DESC);

CREATE INDEX IF NOT EXISTS user_job_feedback_user_job_idx ON public.user_job_feedback USING btree (user_id, job_id);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'saved_jobs_job_id_fkey') THEN
    ALTER TABLE public.saved_jobs ADD CONSTRAINT saved_jobs_job_id_fkey FOREIGN KEY (job_id) REFERENCES public.jobs(id) ON DELETE CASCADE;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'saved_jobs_user_id_fkey') THEN
    ALTER TABLE public.saved_jobs ADD CONSTRAINT saved_jobs_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_job_feedback_company_id_fkey') THEN
    ALTER TABLE public.user_job_feedback ADD CONSTRAINT user_job_feedback_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE SET NULL;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_job_feedback_job_id_fkey') THEN
    ALTER TABLE public.user_job_feedback ADD CONSTRAINT user_job_feedback_job_id_fkey FOREIGN KEY (job_id) REFERENCES public.jobs(id) ON DELETE CASCADE;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_job_feedback_user_id_fkey') THEN
    ALTER TABLE public.user_job_feedback ADD CONSTRAINT user_job_feedback_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;
  END IF;
END
$$;

ALTER TABLE public.saved_jobs ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'saved_jobs' AND policyname = 'saved_jobs_anon_deny') THEN
    CREATE POLICY saved_jobs_anon_deny ON public.saved_jobs TO anon USING (false) WITH CHECK (false);
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'saved_jobs' AND policyname = 'saved_jobs_app_rw_all') THEN
    CREATE POLICY saved_jobs_app_rw_all ON public.saved_jobs TO app_rw USING (true) WITH CHECK (true);
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'saved_jobs' AND policyname = 'saved_jobs_authenticated_deny') THEN
    CREATE POLICY saved_jobs_authenticated_deny ON public.saved_jobs TO authenticated USING (false) WITH CHECK (false);
  END IF;
END
$$;

ALTER TABLE public.user_job_feedback ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'user_job_feedback' AND policyname = 'user_job_feedback_anon_deny') THEN
    CREATE POLICY user_job_feedback_anon_deny ON public.user_job_feedback TO anon USING (false) WITH CHECK (false);
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'user_job_feedback' AND policyname = 'user_job_feedback_app_rw_all') THEN
    CREATE POLICY user_job_feedback_app_rw_all ON public.user_job_feedback TO app_rw USING (true) WITH CHECK (true);
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'user_job_feedback' AND policyname = 'user_job_feedback_authenticated_deny') THEN
    CREATE POLICY user_job_feedback_authenticated_deny ON public.user_job_feedback TO authenticated USING (false) WITH CHECK (false);
  END IF;
END
$$;
