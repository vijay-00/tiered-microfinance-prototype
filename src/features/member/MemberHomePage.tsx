import { Link } from 'react-router-dom';
import { LoadingTiles } from '@/components/LoadingTiles';
import { PageHeader } from '@/components/PageHeader';
import { MoneyText } from '@/components/finance/MoneyText';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formatBps } from '@/domain/money';
import { formatDate, plural } from '@/lib/format';
import { useQuery } from '@/lib/useQuery';
import { useAppStore, useRepositories } from '@/store/context';
import { selectCurrentUser } from '@/store/selectors';

/**
 * The member's own view. It shows the retail rate and nothing else about
 * pricing: the wholesale rate and the society's margin are not the member's
 * business, and this screen never receives them.
 */
export function MemberHomePage() {
  const user = useAppStore(selectCurrentUser);
  const version = useAppStore((s) => s.world.eventCount);
  const repositories = useRepositories();
  const memberId = user.memberId!;
  const { data, error } = useQuery(`member-loans:${memberId}:${version}`, () =>
    repositories.member.getLoans(memberId),
  );

  return (
    <>
      <PageHeader title="My loans" description={`Welcome, ${user.name}`} />
      {error ? <p className="mb-4 text-sm text-bad">Your loans could not be loaded: {error}</p> : null}
      {!data ? (
        <LoadingTiles count={1} />
      ) : data.length === 0 ? (
        <p className="text-sm text-muted-foreground">You have no loans with the society.</p>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {data.map((loan) => (
            <Card key={loan.loanId}>
              <CardHeader>
                <CardTitle>
                  Loan of <MoneyText paise={loan.principal} />
                </CardTitle>
                {loan.status !== 'ACTIVE' ? (
                  <Badge tone="good">Repaid</Badge>
                ) : loan.daysPastDue > 0 ? (
                  <Badge tone="bad">{plural(loan.daysPastDue, 'day')} overdue</Badge>
                ) : loan.dueNow > 0 ? (
                  <Badge tone="warn">Due today</Badge>
                ) : (
                  <Badge tone="good">Up to date</Badge>
                )}
              </CardHeader>
              <CardContent>
                <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
                  <div>
                    <dt className="text-xs text-muted-foreground">Still to repay</dt>
                    <dd className="font-semibold"><MoneyText paise={loan.outstanding} /></dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Monthly instalment</dt>
                    <dd className="font-semibold"><MoneyText paise={loan.emi} /></dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Instalments paid</dt>
                    <dd className="tabular-nums">
                      {loan.instalmentsPaid} of {loan.instalmentsTotal}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Interest rate</dt>
                    <dd>{formatBps(loan.rateBps)} a year</dd>
                  </div>
                  {loan.dueNow > 0 ? (
                    <div className="col-span-2">
                      <dt className="text-xs text-muted-foreground">To pay now</dt>
                      <dd className="font-semibold text-bad"><MoneyText paise={loan.dueNow} /></dd>
                    </div>
                  ) : null}
                  {loan.nextInstalment ? (
                    <div className="col-span-2">
                      <dt className="text-xs text-muted-foreground">Next instalment</dt>
                      <dd>
                        <MoneyText paise={loan.nextInstalment.amount} /> on {formatDate(loan.nextInstalment.dueOn)}
                      </dd>
                    </div>
                  ) : null}
                </dl>
                <Link to={`/me/loans/${loan.loanId}`} className="mt-4 inline-block text-sm text-primary hover:underline">
                  Your schedule and payments
                </Link>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
