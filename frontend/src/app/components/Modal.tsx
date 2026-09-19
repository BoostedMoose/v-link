import React, { useEffect, useState } from 'react';
import ReactDOM from 'react-dom';
import styled from 'styled-components';
import { Typography } from '@/theme/styles/Typography';
import { Button } from '@/theme/styles/Inputs';
import { APP } from '@/store/Store';

interface OverlayProps {
  $visible: boolean;
}

interface ContentProps {
  $visible: boolean;
}

const Overlay = styled.div<OverlayProps>`
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background-color: rgba(0, 0, 0, 0.5);
  backdrop-filter: blur(10px);
  display: flex;
  justify-content: center;
  align-items: center;
  z-index: 4;

  opacity: ${({ $visible }) => ($visible ? 1 : 0)};
  transition: opacity 0.3s ease-in-out;
`;

const Content = styled.div<ContentProps>`
  position: relative;
  box-sizing: border-box;
  background: #151515;
  padding: clamp(12px, 3vh, 30px);
  border-radius: 10px;
  text-align: center;
  color: none;
  white-space: pre-line;

  min-width: min(300px, calc(100vw - 20px));
  max-width: calc(100vw - 20px);
  max-height: calc(100vh - 20px);
  max-height: calc(100dvh - 20px);
  overflow-y: auto;
  gap: clamp(8px, 2vh, 20px);

  > h3 { margin: 0; line-height: 1.1; max-width: calc(100% - 52px); }

  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  opacity: ${({ $visible }) => ($visible ? 1 : 0)};
  transform: ${({ $visible }) => ($visible ? 'scale(1)' : 'scale(0.9)')};
  transition: opacity 0.3s ease-in-out, transform 0.3s ease-in-out;
`;

const Exit = styled.button`
  position: absolute;
  top: 8px;
  right: 8px;
  border: none;
  border-radius: 10px;
  width: 44px;
  height: 44px;
  background: #303030;
  font-size: 24px;
  line-height: 1;
  font-weight: bold;
  cursor: pointer;
  color: #DBDBDB;

  &:hover, &:focus-visible { background: #505050; }
`;

const Modal = () => {
  const modalSettings = APP((state) => state.system.modal);

  const Body1 = Typography.Body1;
  const Display2 = Typography.Display2;
  const [visible, setVisible] = useState(false);
  const [shouldRender, setShouldRender] = useState(modalSettings.visible);

  useEffect(() => {
    if (modalSettings.visible) {
      setShouldRender(true);
      setTimeout(() => setVisible(true), 100); // Ensure transition triggers
    } else {
      setVisible(false);
      setTimeout(() => setShouldRender(false), 300); // Delay unmounting until fade-out finishes
    }
  }, [modalSettings.visible, shouldRender]);

  if (!shouldRender) return null; // Prevent render when modal is fully closed

  return ReactDOM.createPortal(
    <Overlay $visible={modalSettings.visible}>
      <Content $visible={modalSettings.visible}>
        <Display2>{modalSettings.title}</Display2>
        {modalSettings.content}
        {modalSettings.exit ? 
        <Exit type="button" aria-label="Close modal" onClick={closeModal}>×</Exit>
        : null }
      </Content>
    </Overlay>,
    document.getElementById('root')!
  );
};

const openModal = (title: string, body: React.ReactNode, button?: string, action?: () => void) => {
  const appUpdate = APP.getState().update;


  const content = (
    <>
      <div style={{ color: 'white' }}>{body}</div>
      {button && <Button onClick={action}>{button}</Button>}
    </>
  );

  appUpdate((state) => {
    state.system.modal.visible = true;
    state.system.modal.title = title;
    state.system.modal.exit = true;
    state.system.modal.content = content;
  });
};

const closeModal = () => {
  const appUpdate = APP.getState().update;

  appUpdate((state) => {
    state.system.modal.visible = false;
    state.system.modal.title = null;
    state.system.modal.exit = null;
    state.system.modal.content = null;
  });
};

export { Modal, openModal, closeModal };
