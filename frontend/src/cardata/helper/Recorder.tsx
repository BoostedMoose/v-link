import React, { useState, useEffect, useRef } from 'react';
import { saveAs } from 'file-saver';

interface RecorderProps {
    data: Record<string, string | number>;
    timestamp: string;
    resolution: number;
    recording: boolean;
    settings: any;
    modules: any;
}

const Recorder: React.FC<RecorderProps> = ({ data, timestamp, resolution, recording, settings, modules }) => {
    const [recordedData, setRecordedData] = useState<Record<string, { timestamp: string; value: number }[]>>({});
    const dataRef = useRef(data);
    const timeRef = useRef(timestamp);
    const recordedDataRef = useRef(recordedData);

    // Exclude _ts keys and the global timestamp — those are not sensor values
    const datasets = Object.keys(data)
        .filter(key => !key.endsWith('_ts'))
        .map((sensorLabel) => {
            const config = modules['sensorType']?.(settings);

            return {
                label: sensorLabel,
                sensorLabel,
                yMin: config?.min_value ?? -Infinity,
                yMax: config?.max_value ?? Infinity,
            };
        });

    // Update data ref to avoid stale closure
    useEffect(() => {
        dataRef.current = data;
    }, [data]);



    useEffect(() => {
        timeRef.current = timestamp;
    }, [timestamp]);

    // Recording logic
    useEffect(() => {
        let interval: NodeJS.Timeout | null = null;

        if (recording) {
            interval = setInterval(() => {
                setRecordedData(prevData => {
                    const updated = { ...prevData };

                    // Read the global timestamp once per tick — all sensors share it
                    const timestamp = String(timeRef.current ?? new Date().toISOString());

                    datasets.forEach(({ label, sensorLabel, yMin, yMax }) => {
                        const value = dataRef.current[sensorLabel];
                        const numValue = isNaN(Number(value)) ? 0 : Math.max(yMin, Math.min(Number(value), yMax));

                        if (!updated[label]) updated[label] = [];
                        updated[label].push({ timestamp, value: numValue });
                    });

                    recordedDataRef.current = updated;
                    return updated;
                });
            }, resolution);
        } else {
            if (interval) {
                clearInterval(interval);
                exportData();
            }
        }

        return () => {
            if (interval) {
                clearInterval(interval);
                exportData();
            }
        };
    }, [recording, resolution, settings, modules]);

    const exportData = () => {
        const date = new Date();
        const timestamp = date.toISOString().replace(/[-:T.]/g, '_');

        const data = recordedDataRef.current;
        const labels = Object.keys(data);

        if (labels.length === 0) return;

        // 1. Collect and sort all unique timestamps
        const allTimestamps = Array.from(
            new Set(labels.flatMap(label => data[label].map(e => e.timestamp)))
        ).sort((a, b) => Number(a.replace(',', '.')) - Number(b.replace(',', '.')));

        // 2. Initialize an object to track the "Last Known Value" for each sensor
        const lastKnownValues: Record<string, string | number> = {};
        labels.forEach(label => {
            lastKnownValues[label] = '';
        });

        // 3. Build CSV header (German format: semicolon separator)
        const header = ['timestamp', ...labels].join(';');

        // Helper: format a value for German CSV (decimal comma)
        const formatValue = (val: string | number): string => {
            if (typeof val === 'number') {
                return String(val).replace('.', ',');
            }
            if (typeof val === 'string' && val !== '') {
                const asNum = Number(val);
                if (!isNaN(asNum)) {
                    return String(asNum).replace('.', ',');
                }
            }
            return String(val);
        };

        // 4. Build rows using Forward Fill logic
        const rows = allTimestamps.map(ts => {
            const rowValues = labels.map(label => {
                const entry = data[label].find(e => e.timestamp === ts);

                if (entry !== undefined) {
                    lastKnownValues[label] = entry.value;
                }

                return formatValue(lastKnownValues[label]);
            });

            return [ts, ...rowValues].join(';');
        });

        const csv = [header, ...rows].join('\n');
        // BOM (\uFEFF) ensures Excel erkennt UTF-8 korrekt
        const blob = new Blob(['\uFEFF', csv], { type: 'text/csv;charset=utf-8;' });
        saveAs(blob, `V-Link_Recording_${timestamp}.csv`);
    };

    return null;
};

export default Recorder;
