import { useEffect, useRef } from 'react';
import { useNamespaces } from '@/socket/Namespaces';
import { openModal, closeModal } from '@/app/components/Modal';


const socket = useNamespaces();

interface DisplayProps {
  ignition: boolean;
  autoShutdown: boolean;
  shutdownDelay: number;
  messageTimeout: number;
  updateApp: (fn: (state: any) => void) => void;
}

const Ignition: React.FC<DisplayProps> = ({
  ignition,
  autoShutdown,
  shutdownDelay,
  messageTimeout,
  updateApp,
}) => {
  const extendedTimer = useRef<NodeJS.Timeout | null>(null);
  const shutdownTimer = useRef<NodeJS.Timeout | null>(null);

  const startShutdownTimer = () => {
    shutdownTimer.current = setTimeout(() => {
      socket.log.emit('info', 'Shutting Down');
      socket.sys.emit('systemTask', 'shutdown'); // Uncomment to actually trigger shutdown
    }, shutdownDelay * 1000);
  };

  const startExtendedTimer = () => {
    extendedTimer.current = setTimeout(() => {
      // If user dismissed, re-trigger the modal
      showShutdownModal();
      startShutdownTimer();
    }, messageTimeout * 60 * 1000); // 5 minutes timeout for dismissal
  };

  const handleDismiss = () => {
    if (shutdownTimer.current) clearTimeout(shutdownTimer.current);

    // Start the extended timer (5 minutes)
    startExtendedTimer();

    // Close the modal
    closeModal();
  };

  const showShutdownModal = () => {
    openModal(
      'Ignition Off',
      `System will shut down in ${shutdownDelay} seconds to prevent battery drain. \nClick to dismiss for ${messageTimeout} minutes.`,
      'DISMISS',
      handleDismiss
    );
  };

  useEffect(() => {
    if (!ignition && autoShutdown) {
      // If ignition is off, show the shutdown modal and start the shutdown timer
      showShutdownModal();
      startShutdownTimer();
    } else {
      // If ignition is on, hide the modal (cleanup)
      if (shutdownTimer.current) clearTimeout(shutdownTimer.current);
      if (extendedTimer.current) clearTimeout(extendedTimer.current);

      updateApp((state) => {
        state.system.modal.visible = false;
      });
    }

    // Cleanup timers on component unmount or when conditions change
    return () => {
      if (shutdownTimer.current) clearTimeout(shutdownTimer.current);
      if (extendedTimer.current) clearTimeout(extendedTimer.current);
    };
  }, [ignition, autoShutdown, shutdownDelay, messageTimeout, updateApp]);

  return null;
};

export default Ignition;
