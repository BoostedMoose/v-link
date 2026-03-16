import { useEffect } from 'react';
import { useNamespaces } from '@/socket/Namespaces';
const socket = useNamespaces();

interface DisplayProps {
    autoOpen: boolean;
}

const Display: React.FC<DisplayProps> = ({ autoOpen }) => {

    // Auto-open Display Unit
    useEffect(() => {
        if (autoOpen) {
            socket.log.emit('info', 'Opening RTI')
            socket.sys.emit("systemTask", "rti")
        }
    }, [])

    return null;

}

export default Display;