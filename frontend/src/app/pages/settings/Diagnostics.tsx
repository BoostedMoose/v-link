import { useState, useEffect } from 'react';
import styled, { useTheme } from 'styled-components';

import { Button } from '@/theme/styles/Inputs';
import { Typography } from '@/theme/styles/Typography';
import { APP, useThemeColor } from '@/store/Store';
import { openModal, closeModal } from '@/app/components/Modal';
import { useNamespaces } from '@/socket/Namespaces';

const socket = useNamespaces();

const Divider = styled.div`
    flex: 1 1 0px;
    border-bottom: 1px solid ${({ theme }) => theme.colors.dark};
    margin-left: 5px;
    margin-right: 5px;
    margin-top: 5px;
`

const Element = styled.div`
    display: flex;
    justify-content: center;
    align-items: center;
    flex-direction: row;

    height: 35px;
    width: 100%;

    margin-bottom: 12px;
`

const ResultElement = styled(Element)`
    height: 50px;
`

type DtcResult = {
  name: string
  id: string
  can_id: string | null
  has_dtc: boolean | null
  dtc: string | null
}

const SCAN_WARNING = 'For best results, make sure the ignition is in position II (ACC/ON) with the engine off.\n\nIt\'s normal for the dashboard lights to flash while scanning.'

const Diagnostics = () => {
  const Title = Typography.Title
  const Caption2 = Typography.Caption2

  const theme = useTheme()
  const themeColor = useThemeColor()

  const [dtcStatus, setDtcStatus] = useState<'idle' | 'scanning' | 'complete'>('idle')
  const [dtcResults, setDtcResults] = useState<DtcResult[]>([])
  const [reportPath, setReportPath] = useState<string | null>(null)

  useEffect(() => {
    socket.dtc.on('progress', (r: DtcResult) => setDtcResults(prev => [...prev, r]))
    socket.dtc.on('complete', () => setDtcStatus('complete'))
    socket.dtc.on('error', () => setDtcStatus('idle'))
    socket.dtc.on('report_saved', ({ path }: { path: string }) => setReportPath(path))
    return () => {
      socket.dtc.off('progress')
      socket.dtc.off('complete')
      socket.dtc.off('error')
      socket.dtc.off('report_saved')
    }
  }, [])

  const startScan = (mode: 'targeted' | 'full') => {
    closeModal()
    setDtcStatus('scanning')
    setDtcResults([])
    setReportPath(null)
    socket.dtc.emit('read', { mode })
  }

  const confirmScan = (mode: 'targeted' | 'full') => {
    openModal('Before you scan', SCAN_WARNING, 'Start Scan', () => startScan(mode))
  }

  return (
    <>
      <Element>
        <Title>Diagnostics</Title>
      </Element>
      <Element>
        <Caption2>Scan Known Modules</Caption2>
        <Divider />
        <Button
          theme={theme}
          disabled={dtcStatus === 'scanning'}
          onClick={() => confirmScan('targeted')}>
          {dtcStatus === 'scanning' ? 'Scanning...' : 'Read DTC'}
        </Button>
      </Element>
      <Element>
        <Caption2>Full Scan (00 - FF)</Caption2>
        <Divider />
        <Button
          theme={theme}
          disabled={dtcStatus === 'scanning'}
          onClick={() => confirmScan('full')}>
          {dtcStatus === 'scanning' ? 'Scanning...' : 'Scan All'}
        </Button>
      </Element>

      {dtcStatus === 'scanning' &&
        <Element>
          <Caption2>Cancel current scan</Caption2>
          <Divider />
          <Button
            theme={theme}
            onClick={() => socket.dtc.emit('stop')}>
            Stop
          </Button>
        </Element>
      }

      {dtcResults.map((r) => (
        <ResultElement key={r.id}>
          <Caption2>{r.name} ({r.id})</Caption2>
          <Divider />
          <Caption2 style={{ minWidth: '110px', textAlign: 'center' }}>
            {r.can_id ?? '—'}
          </Caption2>
          <Divider />
          <Caption2 style={{
            color: r.has_dtc === null
              ? theme.colors.light
              : r.has_dtc
                ? '#ff4444'
                : theme.colors.theme[themeColor].active,
            ...(r.has_dtc === false && { fontSize: '20px' })
          }}>
            {r.has_dtc === null ? 'No response' : r.has_dtc ? r.dtc : '✓'}
          </Caption2>
        </ResultElement>
      ))}

      {dtcStatus === 'complete' && dtcResults.length > 0 &&
        <Element>
          <Caption2>
            {reportPath ? `Saved: ${reportPath}` : 'Export results'}
          </Caption2>
          <Divider />
          <Button
            theme={theme}
            onClick={() => { setReportPath(null); socket.dtc.emit('save_report', { results: dtcResults, mode: 'scan' }) }}>
            Save Report
          </Button>
        </Element>
      }
      <p />
    </>
  )
}

export default Diagnostics
