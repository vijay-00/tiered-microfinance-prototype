import { formatBps } from '@/domain/money';
import type { PoolEconomics } from '@/domain/origination';
import type { Policy } from '@/domain/types';
import { MoneyText } from './MoneyText';
import { SplitBar } from './SplitBar';

/**
 * A pool's whole business case in one list: what members will pay in interest,
 * what the federation is owed out of it, and the spread the society keeps.
 */
export function PoolEconomicsList({ economics, policy }: { economics: PoolEconomics; policy: Policy }) {
  const spread = policy.retailRateBps - policy.wholesaleRateBps;
  return (
    <div className="space-y-3 text-sm">
      <dl className="space-y-1.5">
        <div className="flex justify-between gap-3">
          <dt className="text-muted-foreground">Requested</dt>
          <dd className="font-semibold">
            <MoneyText paise={economics.total} />
          </dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-muted-foreground">Longest loan</dt>
          <dd>{economics.longestTenureMonths ? `${economics.longestTenureMonths} months` : '–'}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-muted-foreground">Average tenure, by amount</dt>
          <dd>{economics.weightedTenureMonths ? `${economics.weightedTenureMonths.toFixed(1)} months` : '–'}</dd>
        </div>
      </dl>
      <div className="border-t pt-3">
        <p className="mb-1.5 text-xs font-medium text-muted-foreground">
          Over the life of the loans, if every member pays on time
        </p>
        <dl className="space-y-1.5">
          <div className="flex justify-between gap-3">
            <dt className="text-muted-foreground">Members pay in interest at {formatBps(policy.retailRateBps)}</dt>
            <dd>
              <MoneyText paise={economics.retailInterest} />
            </dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-muted-foreground">Owed to the federation at {formatBps(policy.wholesaleRateBps)}</dt>
            <dd>
              <MoneyText paise={economics.wholesaleInterest} />
            </dd>
          </div>
          <div className="flex justify-between gap-3 font-semibold text-good">
            <dt>Kept by the society, a {formatBps(spread)} spread</dt>
            <dd>
              <MoneyText paise={economics.margin} />
            </dd>
          </div>
        </dl>
        {economics.retailInterest > 0 ? (
          <SplitBar
            className="mt-2"
            toFederation={economics.wholesaleInterest}
            retained={economics.margin}
            showLegend={false}
          />
        ) : null}
      </div>
    </div>
  );
}
