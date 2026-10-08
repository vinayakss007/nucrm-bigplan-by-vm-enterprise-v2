// @vitest-environment jsdom
/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #2208 — behaviour parity for the react-table v9 `./legacy` shim.
 *
 * `components/ui/data-table.tsx` now imports `useLegacyTable` and the
 * `get*RowModel` markers from `@tanstack/react-table/legacy` instead of the v8
 * entry point. Those markers are not the row models themselves: v9's legacy
 * layer reads them once, at mount, and swaps the matching feature slots in. A
 * missing or mis-wired marker degrades silently — the table still renders, it
 * just stops filtering, sorting or paginating — and `DataTable` backs every
 * list page in the app, none of which had a render test. So this file asserts
 * each feature the shim is supposed to enable, through the DOM the pages
 * actually produce.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import '@testing-library/jest-dom/vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  ColumnDef,
  DataTable,
  createSortableHeader,
} from '@/components/ui/data-table';

interface Person {
  id: string;
  name: string;
  age: number;
}

const PEOPLE: Person[] = [
  { id: 'p1', name: 'Charlie', age: 30 },
  { id: 'p2', name: 'Alice', age: 25 },
  { id: 'p3', name: 'Bob', age: 35 },
  { id: 'p4', name: 'Dana', age: 28 },
  { id: 'p5', name: 'Eli', age: 41 },
];

const columns: ColumnDef<Person, Person>[] = [
  {
    id: 'select',
    header: '',
    enableSorting: false,
    enableHiding: false,
    cell: ({ row }) => (
      <input
        type="checkbox"
        aria-label={`Select ${row.original.name}`}
        checked={row.getIsSelected()}
        onChange={() => row.toggleSelected()}
      />
    ),
  },
  createSortableHeader('Name', 'name'),
  { accessorKey: 'age', header: 'Age' },
];

// @tanstack/react-virtual builds a ResizeObserver on mount, and jsdom has none.
beforeAll(() => {
  const g = globalThis as typeof globalThis & { ResizeObserver?: typeof ResizeObserver };
  if (!g.ResizeObserver) {
    class Obs {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    }
    g.ResizeObserver = Obs as unknown as typeof ResizeObserver;
  }
});

const rowTexts = (): string[] =>
  screen
    .getAllByRole('row')
    .slice(1) // header row
    .map((row) => within(row).getAllByRole('cell')[1]?.textContent ?? '');

/** The wiring every real list page uses: the parent owns pageIndex. */
function ControlledPager() {
  const [pageIndex, setPageIndex] = useState(0);
  return (
    <DataTable
      columns={columns}
      data={PEOPLE}
      pageSize={2}
      pageIndex={pageIndex}
      onPaginationChange={setPageIndex}
    />
  );
}

describe('#2208 DataTable on the v9 legacy shim', () => {
  it('renders every row through the core row model', () => {
    render(<DataTable columns={columns} data={PEOPLE} />);
    expect(rowTexts()).toEqual(['Charlie', 'Alice', 'Bob', 'Dana', 'Eli']);
  });

  it('narrows rows with the global filter (filteredRowModel)', async () => {
    render(<DataTable columns={columns} data={PEOPLE} />);
    await userEvent.type(screen.getByRole('textbox', { name: 'Search...' }), 'Ali');
    expect(rowTexts()).toEqual(['Alice']);
  });

  it('shows the empty state when the filter matches nothing', async () => {
    render(<DataTable columns={columns} data={PEOPLE} />);
    await userEvent.type(screen.getByRole('textbox', { name: 'Search...' }), 'zzzz');
    expect(screen.getByText('No results')).toBeInTheDocument();
    expect(screen.queryByText('Alice')).not.toBeInTheDocument();
  });

  it('reorders rows when a sortable header is clicked (sortedRowModel)', async () => {
    render(<DataTable columns={columns} data={PEOPLE} />);
    const nameHeader = screen.getByRole('columnheader', { name: 'Name' });
    const button = within(nameHeader).getByRole('button', { name: 'Name' });

    await userEvent.click(button);
    expect(button).toHaveAttribute('aria-sort', 'ascending');
    expect(rowTexts()).toEqual(['Alice', 'Bob', 'Charlie', 'Dana', 'Eli']);

    await userEvent.click(button);
    expect(button).toHaveAttribute('aria-sort', 'descending');
    expect(rowTexts()[0]).toBe('Eli');
  });

  it('slices the row model to the page size (paginatedRowModel)', () => {
    render(<DataTable columns={columns} data={PEOPLE} pageSize={2} />);
    expect(rowTexts()).toEqual(['Charlie', 'Alice']);
    expect(screen.getByText('1/3')).toBeInTheDocument();
  });

  it('walks pages through the parent-controlled pagination props', async () => {
    render(<ControlledPager />);
    expect(rowTexts()).toEqual(['Charlie', 'Alice']);

    await userEvent.click(screen.getByRole('button', { name: 'Go to next page' }));
    expect(screen.getByText('2/3')).toBeInTheDocument();
    expect(rowTexts()).toEqual(['Bob', 'Dana']);

    await userEvent.click(screen.getByRole('button', { name: 'Go to last page' }));
    expect(screen.getByText('3/3')).toBeInTheDocument();
    expect(rowTexts()).toEqual(['Eli']);
  });

  // Pinned, not endorsed. DataTable always passes a controlled `state.pagination`
  // and only wires the table's own onPaginationChange when a parent supplies one,
  // so in uncontrolled client mode the built-in controls write to state the render
  // never reads. v8 behaved exactly the same: its useReactTable overlays
  // options.state on the internal state it keeps. Asserting it here so a future
  // change is judged against the shim, not blamed on it — the gap itself is the
  // client-side-pagination bug, not #2208.
  it('leaves the built-in controls inert without a parent pagination handler (v8 parity)', async () => {
    render(<DataTable columns={columns} data={PEOPLE} pageSize={2} />);
    await userEvent.click(screen.getByRole('button', { name: 'Go to next page' }));
    expect(screen.getByText('1/3')).toBeInTheDocument();
    expect(rowTexts()).toEqual(['Charlie', 'Alice']);
  });

  it('leaves all rows on one page in manual mode (no paginatedRowModel)', async () => {
    render(<DataTable columns={columns} data={PEOPLE} pageSize={2} manualPagination total={999} />);
    expect(rowTexts()).toHaveLength(5);
    // Manual mode still reports the server-side row count, not the page slice.
    expect(screen.getByText('1/500')).toBeInTheDocument();
  });

  it('tracks selection and reports it to the parent (rowSelection feature)', async () => {
    const onRowSelectionChange = vi.fn();
    render(
      <DataTable
        columns={columns}
        data={PEOPLE}
        enableRowSelection
        enableBulkActions
        onRowSelectionChange={onRowSelectionChange}
      />
    );

    await userEvent.click(screen.getByRole('checkbox', { name: 'Select Bob' }));
    // Asserted by shape, not by row id: the id scheme is TanStack's business,
    // the contract with every list page is "exactly this one row is selected".
    const selection = onRowSelectionChange.mock.lastCall?.[0] as Record<string, boolean>;
    expect(Object.values(selection)).toEqual([true]);
    expect(screen.getByRole('checkbox', { name: 'Select Bob' })).toBeChecked();
    expect(screen.getByText('1 of 5 row(s) selected.')).toBeInTheDocument();
  });

  it('hides a column through the visibility menu (columnVisibility feature)', async () => {
    render(<DataTable columns={columns} data={PEOPLE} />);
    await userEvent.click(screen.getByRole('button', { name: /View/ }));
    await userEvent.click(await screen.findByRole('menuitemcheckbox', { name: 'age' }));
    expect(screen.queryByRole('columnheader', { name: 'Age' })).not.toBeInTheDocument();
  });
});
