import { Search } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { LoadingTiles } from '@/components/LoadingTiles';
import { PageHeader } from '@/components/PageHeader';
import { MoneyText } from '@/components/finance/MoneyText';
import { StatTile } from '@/components/finance/StatTile';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/form';
import { Table, TBody, TD, TH, THead } from '@/components/ui/table';
import { sum } from '@/domain/money';
import type { MemberRow } from '@/domain/origination';
import { can } from '@/domain/permissions';
import { plural } from '@/lib/format';
import { useQuery } from '@/lib/useQuery';
import { useAppStore, useRepositories } from '@/store/context';
import { selectCurrentUser } from '@/store/selectors';

function matches(row: MemberRow, term: string): boolean {
  const { name, village, membershipNo, occupation } = row.member;
  return [name, village, membershipNo, occupation].some((field) => field.toLowerCase().includes(term));
}

export function MembersPage() {
  const user = useAppStore(selectCurrentUser);
  const version = useAppStore((s) => s.world.eventCount);
  const graceDays = useAppStore((s) => s.world.policy.graceDays);
  const repositories = useRepositories();
  const societyId = user.societyId!;
  const [search, setSearch] = useState('');
  const { data, error, loading } = useQuery(`members:${societyId}:${version}`, () => repositories.members.list(societyId));

  const term = search.trim().toLowerCase();
  const rows = data?.filter((row) => !term || matches(row, term));
  const borrowing = data?.filter((row) => row.activeLoans > 0) ?? [];

  return (
    <>
      <PageHeader
        title="Member register"
        description="Everyone who holds shares in the society, and what each owes today."
        actions={
          can(user.role, 'SUBMIT_APPLICATION') ? (
            <Button asChild>
              <Link to="/applications/new">New application</Link>
            </Button>
          ) : null
        }
      />
      {error ? <p className="mb-4 text-sm text-bad">The register could not be loaded: {error}</p> : null}
      {!data || !rows ? (
        <LoadingTiles count={3} className="sm:grid-cols-3" />
      ) : (
        <>
          <section aria-label="Membership" className="grid gap-3 sm:grid-cols-3">
            <StatTile
              label="Members"
              value={data.filter((row) => row.member.status === 'ACTIVE').length}
              detail={`active, of ${data.length} on the register`}
            />
            <StatTile label="Borrowing now" value={borrowing.length} detail={plural(sum(borrowing.map((r) => r.activeLoans)), 'active loan')} />
            <StatTile label="Outstanding" value={<MoneyText paise={sum(data.map((r) => r.outstanding))} />} detail="Principal members owe the society" />
          </section>

          <div className="relative mt-5 max-w-sm">
            <Search className="pointer-events-none absolute top-2.5 left-2.5 size-4 text-muted-foreground" aria-hidden />
            <Input
              type="search"
              aria-label="Search members"
              placeholder="Name, village, membership no. or occupation"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-8"
            />
          </div>

          <Card className="mt-3" aria-busy={loading}>
            <Table>
              <caption className="sr-only">Members of the society</caption>
              <THead>
                <tr>
                  <TH>Member</TH>
                  <TH>Village</TH>
                  <TH>Occupation</TH>
                  <TH numeric>Loans</TH>
                  <TH numeric>Outstanding</TH>
                  <TH>Status</TH>
                </tr>
              </THead>
              <TBody>
                {rows.map((row) => (
                  <tr key={row.member.id}>
                    <TD>
                      <Link to={`/members/${row.member.id}`} className="font-medium hover:underline">
                        {row.member.name}
                      </Link>
                      <span className="block text-xs text-muted-foreground">{row.member.membershipNo}</span>
                    </TD>
                    <TD>{row.member.village}</TD>
                    <TD>{row.member.occupation}</TD>
                    <TD numeric>{row.activeLoans}</TD>
                    <TD numeric>{row.outstanding > 0 ? <MoneyText paise={row.outstanding} /> : <span className="text-muted-foreground">–</span>}</TD>
                    <TD>
                      <div className="flex flex-wrap gap-1">
                        {row.member.status !== 'ACTIVE' ? (
                          <Badge>{row.member.status === 'DORMANT' ? 'Dormant' : 'Exited'}</Badge>
                        ) : null}
                        {row.daysPastDue > graceDays ? (
                          <Badge tone="bad">{plural(row.daysPastDue, 'day')} late</Badge>
                        ) : row.daysPastDue > 0 ? (
                          <Badge tone="warn">In grace</Badge>
                        ) : null}
                        {row.inProgress ? (
                          <Link to={`/applications/${row.inProgress.id}`}>
                            <Badge tone="info">Applied {row.inProgress.id}</Badge>
                          </Link>
                        ) : null}
                      </div>
                    </TD>
                  </tr>
                ))}
                {rows.length === 0 ? (
                  <tr>
                    <TD colSpan={6} className="py-6 text-center text-muted-foreground">
                      No member matches “{search.trim()}”.
                    </TD>
                  </tr>
                ) : null}
              </TBody>
            </Table>
          </Card>
        </>
      )}
    </>
  );
}
