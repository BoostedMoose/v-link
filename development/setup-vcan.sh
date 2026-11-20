sudo ip link delete vcan0
sudo modprobe vcan
sudo modprobe uinput
sudo ip link add dev vcan0 type vcan
sudo ip link set up vcan0