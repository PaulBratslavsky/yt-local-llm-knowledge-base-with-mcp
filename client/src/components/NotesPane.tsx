import { useCallback, useEffect, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { buildMarkdownComponents } from './TimecodeMarkdown';
import { Button } from '#/components/ui/button';
import {
  deleteNote,
  listNotesForVideo,
  type ListNotesResult,
} from '#/data/server-functions/notes';
import type { StrapiNote } from '#/lib/services/notes';

type Props = {
  videoDocumentId: string;
  onSeek: (seconds: number) => void;
  /** Bumped by the parent (e.g. after VideoChat saves a note) to force
   * a refetch so the new note appears without a page reload. */
  refreshKey?: number;
};

const SOURCE_LABEL: Record<StrapiNote['source'], string> = {
  chat: 'Chat',
  'digest-chat': 'Digest chat',
  mcp: 'MCP',
  manual: 'Manual',
};

const SOURCE_BADGE: Record<StrapiNote['source'], string> = {
  chat: 'border-blue-500/30 bg-blue-500/10 text-blue-700 dark:text-blue-400',
  'digest-chat':
    'border-purple-500/30 bg-purple-500/10 text-purple-700 dark:text-purple-400',
  mcp: 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400',
  manual: 'border-[var(--line)] bg-[var(--bg-subtle)] text-[var(--ink-muted)]',
};

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function NotesPane({
  videoDocumentId,
  onSeek,
  refreshKey = 0,
}: Readonly<Props>) {
  const [state, setState] = useState<
    | { kind: 'loading' }
    | { kind: 'ready'; notes: StrapiNote[] }
    | { kind: 'error'; error: string }
  >({ kind: 'loading' });
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res: ListNotesResult = await listNotesForVideo({
      data: { videoDocumentId },
    });
    if (res.status === 'error') {
      setState({ kind: 'error', error: res.error });
      return;
    }
    setState({ kind: 'ready', notes: res.notes });
  }, [videoDocumentId]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  const handleDelete = async (documentId: string) => {
    if (!window.confirm('Delete this note?')) return;
    setDeletingId(documentId);
    const res = await deleteNote({ data: { documentId } });
    setDeletingId(null);
    if (res.status === 'ok') await load();
  };

  if (state.kind === 'loading') {
    return (
      <div className="py-10 text-center text-sm text-[var(--ink-muted)]">
        Loading notes…
      </div>
    );
  }

  if (state.kind === 'error') {
    return (
      <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
        Couldn&apos;t load notes: {state.error}
      </div>
    );
  }

  if (state.notes.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-[var(--line)] bg-[var(--card)] p-8 text-center">
        <p className="text-sm text-[var(--ink)]">No notes yet.</p>
        <p className="mt-2 text-xs text-[var(--ink-muted)]">
          Use <span className="font-medium">Summarize to note</span> in the chat
          to save the conversation as a markdown note. Notes written from Claude
          Desktop via MCP also show up here.
        </p>
      </div>
    );
  }

  return (
    <div className="grid gap-4">
      {state.notes.map((note) => (
        <NoteCard
          key={note.documentId}
          note={note}
          onSeek={onSeek}
          onDelete={() => void handleDelete(note.documentId)}
          deleting={deletingId === note.documentId}
        />
      ))}
    </div>
  );
}

function NoteCard({
  note,
  onSeek,
  onDelete,
  deleting,
}: Readonly<{
  note: StrapiNote;
  onSeek: (seconds: number) => void;
  onDelete: () => void;
  deleting: boolean;
}>) {
  const markdownComponents = buildMarkdownComponents(onSeek);
  return (
    <article className="rounded-2xl border border-[var(--line)] bg-[var(--card)] p-5">
      <header className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          {note.title && (
            <h3 className="text-base font-semibold text-[var(--ink)]">
              {note.title}
            </h3>
          )}
          <div className="mt-1 flex flex-wrap items-center gap-2 text-[0.65rem] text-[var(--ink-muted)]">
            <span
              className={`inline-flex items-center rounded-full border px-2 py-0.5 font-medium ${SOURCE_BADGE[note.source]}`}
            >
              {SOURCE_LABEL[note.source]}
            </span>
            <span>{formatDate(note.createdAt)}</span>
            {note.author && <span>· {note.author}</span>}
          </div>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onDelete}
          disabled={deleting}
        >
          {deleting ? 'Deleting…' : 'Delete'}
        </Button>
      </header>
      <div className="prose prose-sm dark:prose-invert max-w-none text-[var(--ink)]">
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
          {note.body}
        </ReactMarkdown>
      </div>
    </article>
  );
}
