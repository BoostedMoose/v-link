import { useEffect, useMemo, useState } from 'react';
import styled from 'styled-components';
import { Button, Select } from '@/theme/styles/Inputs';
import { openModal } from '@/app/components/Modal';
import { useNamespaces } from '@/socket/Namespaces';

type Release = {
  id: number;
  tag: string;
  name: string;
  prerelease: boolean;
  branch: string;
  published_at: string | null;
};

type Installed = { tag: string | null; branch: string | null; commit: string | null; prerelease: boolean | null };
type Catalogue = { releases: Release[]; installed: Installed; truncated: boolean };

const shortHash = (hash: string) => hash.slice(0, 7);

const Panel = styled.div`
  box-sizing: border-box;
  width: min(680px, calc(100vw - 64px));
  max-height: calc(100vh - 110px);
  max-height: calc(100dvh - 110px);
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 8px;
  text-align: left;
  font-size: 14px;

  label { display: grid; gap: 3px; min-width: 0; }
  select { min-width: 0; }
`;

const ChannelControls = styled.div`
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;

  @media (max-width: 600px) { grid-template-columns: 1fr; }
`;

export default function ReleaseChooser({ currentVersion }: { currentVersion: string }) {
  const socket = useNamespaces();
  const [catalogue, setCatalogue] = useState<Catalogue | null>(null);
  const [error, setError] = useState('');
  const [channel, setChannel] = useState<'stable' | 'prerelease'>('stable');
  const [branch, setBranch] = useState('');
  const [releaseId, setReleaseId] = useState<number | null>(null);
  const [commit, setCommit] = useState<string | null>(null);
  const [commitError, setCommitError] = useState('');
  const [busy, setBusy] = useState(false);
  const [retryCount, setRetryCount] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setError('');
    fetch('http://localhost:4001/api/releases', { signal: controller.signal })
      .then(async response => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Could not load releases');
        setCatalogue(data as Catalogue);
      })
      .catch(() => {
        if (!controller.signal.aborted) setError('Could not load releases. Check the connection and try again.');
      });
    return () => controller.abort();
  }, [retryCount]);

  const branches = useMemo(() => [...new Set(catalogue?.releases
    .filter(release => release.prerelease).map(release => release.branch) ?? [])], [catalogue]);
  const selectedBranch = branches.includes(branch) ? branch : (branches[0] ?? '');
  const choices = useMemo(() => catalogue?.releases.filter(release => channel === 'stable'
    ? !release.prerelease : release.prerelease && release.branch === selectedBranch) ?? [],
  [catalogue, channel, selectedBranch]);
  const selected = choices.find(release => release.id === releaseId) ?? choices[0];

  useEffect(() => {
    if (!selected) return;
    const controller = new AbortController();
    setCommit(null);
    setCommitError('');
    fetch(`http://localhost:4001/api/releases/${selected.id}/commit`, { signal: controller.signal })
      .then(async response => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Could not resolve commit');
        setCommit(data.commit);
      })
      .catch(() => {
        if (!controller.signal.aborted) setCommitError('Could not verify this release. Check the connection and try again.');
      });
    return () => controller.abort();
  }, [selected?.id, retryCount]);

  const install = () => {
    if (!selected || busy || !commit || error || commitError) return;
    setBusy(true);
    socket.sys.timeout(30000).emit('systemTask', 'update', { release_id: selected.id },
      (ackError: Error | null, result?: { ok: boolean; error?: string }) => {
        if (ackError || !result?.ok) {
          setBusy(false);
          setError(result?.error || ackError?.message || 'The update request failed');
          return;
        }
        openModal('Installing V-Link', `Installing ${selected.tag}${selected.prerelease ? ` (${shortHash(commit)})` : ''}. The app will close and reboot after installation. Follow the updater terminal for progress.`);
      });
  };

  return <Panel>
    <div>Installed: {catalogue?.installed.tag || currentVersion}{catalogue?.installed.prerelease && catalogue.installed.commit ? ` · ${shortHash(catalogue.installed.commit)}` : ''}</div>
    {error && <div role="alert" style={{ color: '#ff9898' }}>{error}</div>}
    {commitError && <div role="alert" style={{ color: '#ff9898' }}>{commitError}</div>}
    {(error || commitError) && <Button onClick={() => setRetryCount(count => count + 1)}>Retry</Button>}
    {!catalogue && !error && <div>Loading releases…</div>}
    {catalogue && <>
      <ChannelControls>
        <label>Release channel
          <Select value={channel} onChange={event => { setChannel(event.target.value as 'stable' | 'prerelease'); setReleaseId(null); }}>
            <option value="stable">Stable</option>
            <option value="prerelease" disabled={branches.length === 0}>Prerelease{branches.length === 0 ? ' (none available)' : ''}</option>
          </Select>
        </label>
        {channel === 'prerelease' && <label>Branch
          <Select value={selectedBranch} onChange={event => { setBranch(event.target.value); setReleaseId(null); }}>
            {branches.map(name => <option key={name} value={name}>{name}</option>)}
          </Select>
        </label>}
      </ChannelControls>
      <label>Release (newest first)
        <Select value={selected?.id ?? ''} onChange={event => setReleaseId(Number(event.target.value))} disabled={!selected}>
          {choices.map(release => <option key={release.id} value={release.id}>
            {release.tag}{release.published_at ? ` · ${release.published_at.slice(0, 10)}` : ''}
          </option>)}
        </Select>
      </label>
      {selected ? <>
        {selected.prerelease && <div>Commit: {commit ? shortHash(commit) : commitError ? 'Unavailable' : 'Loading…'}</div>}
        {catalogue.installed.commit === commit && <div>This commit is already installed.</div>}
        <Button disabled={busy || !commit || !!error || !!commitError || catalogue.installed.commit === commit} onClick={install}>
          {busy ? 'Starting…' : catalogue.installed.commit === commit ? 'Already installed' : 'Install selected release'}
        </Button>
      </> : <div>No releases available in this channel.</div>}
      {catalogue.truncated && <div>Showing the 500 most recent GitHub releases.</div>}
    </>}
  </Panel>;
}
