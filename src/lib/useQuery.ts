import { useEffect, useRef, useState } from 'react';

export interface QueryState<T> {
  data: T | undefined;
  error: string | undefined;
  /** True while a request is in flight, including a refresh over shown data. */
  loading: boolean;
}

/**
 * A deliberately small data hook. It refetches whenever `key` changes, keeps
 * showing the previous data while it does, and ignores a response that arrives
 * after a newer request was made.
 */
export function useQuery<T>(key: string, fetcher: () => Promise<T>): QueryState<T> {
  const [state, setState] = useState<QueryState<T>>({ data: undefined, error: undefined, loading: true });
  const latest = useRef(0);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  useEffect(() => {
    const ticket = ++latest.current;
    setState((s) => ({ ...s, loading: true }));
    fetcherRef.current().then(
      (data) => {
        if (ticket === latest.current) setState({ data, error: undefined, loading: false });
      },
      (error: unknown) => {
        if (ticket === latest.current) {
          setState((s) => ({ ...s, error: error instanceof Error ? error.message : String(error), loading: false }));
        }
      },
    );
  }, [key]);

  return state;
}
