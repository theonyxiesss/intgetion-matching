-- Matching tables in their final shape (platform migrations 0012, 0020 and the
-- matching columns of later ones), taken from a database migrated to the latest
-- platform state. On a live database every statement is a no-op; on an empty one it
-- builds the same schema. Safe to run again.

CREATE TABLE IF NOT EXISTS public.matching_jobs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    job_id uuid NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    attempts integer DEFAULT 0 NOT NULL,
    run_after timestamp with time zone DEFAULT now() NOT NULL,
    locked_at timestamp with time zone,
    error text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    finished_at timestamp with time zone,
    CONSTRAINT matching_jobs_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'running'::text, 'done'::text, 'failed'::text])))
);

ALTER TABLE ONLY public.matching_jobs FORCE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.matching_results (
    user_id uuid NOT NULL,
    job_id uuid NOT NULL,
    score numeric(5,4) NOT NULL,
    breakdown jsonb NOT NULL,
    explain jsonb NOT NULL,
    algo_version smallint NOT NULL,
    computed_at timestamp with time zone NOT NULL,
    CONSTRAINT matching_results_score_check CHECK (((score >= (0)::numeric) AND (score <= (1)::numeric)))
);

ALTER TABLE ONLY public.matching_results FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'matching_jobs_pkey') THEN
    ALTER TABLE public.matching_jobs ADD CONSTRAINT matching_jobs_pkey PRIMARY KEY (id);
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'matching_results_pkey') THEN
    ALTER TABLE public.matching_results ADD CONSTRAINT matching_results_pkey PRIMARY KEY (user_id, job_id);
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS matching_jobs_due_idx ON public.matching_jobs USING btree (status, run_after);

CREATE UNIQUE INDEX IF NOT EXISTS matching_jobs_open_job_idx ON public.matching_jobs USING btree (job_id) WHERE (status = ANY (ARRAY['pending'::text, 'running'::text]));

CREATE INDEX IF NOT EXISTS matching_results_user_score_idx ON public.matching_results USING btree (user_id, score DESC);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'matching_jobs_job_id_fkey') THEN
    ALTER TABLE public.matching_jobs ADD CONSTRAINT matching_jobs_job_id_fkey FOREIGN KEY (job_id) REFERENCES public.jobs(id) ON DELETE CASCADE;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'matching_results_job_id_fkey') THEN
    ALTER TABLE public.matching_results ADD CONSTRAINT matching_results_job_id_fkey FOREIGN KEY (job_id) REFERENCES public.jobs(id) ON DELETE CASCADE;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'matching_results_user_id_fkey') THEN
    ALTER TABLE public.matching_results ADD CONSTRAINT matching_results_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;
  END IF;
END
$$;

ALTER TABLE public.matching_jobs ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'matching_jobs' AND policyname = 'matching_jobs_anon_deny') THEN
    CREATE POLICY matching_jobs_anon_deny ON public.matching_jobs TO anon USING (false) WITH CHECK (false);
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'matching_jobs' AND policyname = 'matching_jobs_app_rw_all') THEN
    CREATE POLICY matching_jobs_app_rw_all ON public.matching_jobs TO app_rw USING (true) WITH CHECK (true);
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'matching_jobs' AND policyname = 'matching_jobs_authenticated_deny') THEN
    CREATE POLICY matching_jobs_authenticated_deny ON public.matching_jobs TO authenticated USING (false) WITH CHECK (false);
  END IF;
END
$$;

ALTER TABLE public.matching_results ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'matching_results' AND policyname = 'matching_results_anon_deny') THEN
    CREATE POLICY matching_results_anon_deny ON public.matching_results TO anon USING (false) WITH CHECK (false);
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'matching_results' AND policyname = 'matching_results_app_rw_all') THEN
    CREATE POLICY matching_results_app_rw_all ON public.matching_results TO app_rw USING (true) WITH CHECK (true);
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'matching_results' AND policyname = 'matching_results_authenticated_deny') THEN
    CREATE POLICY matching_results_authenticated_deny ON public.matching_results TO authenticated USING (false) WITH CHECK (false);
  END IF;
END
$$;
