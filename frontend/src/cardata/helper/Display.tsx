import { useEffect } from 'react';
import { Socket } from 'socket.io-client';

interface DisplayProps {
    autoOpen: boolean;
    io: Socket;
}

const Display: React.FC<DisplayProps> = ({ autoOpen, io }) => {

    // Auto-open Display Unit
    useEffect(() => {
        if (autoOpen) {
            console.log('Opening RTI')
            io.emit("systemTask", "rti")
        }
    }, [])

    return null;

}

export default Display;