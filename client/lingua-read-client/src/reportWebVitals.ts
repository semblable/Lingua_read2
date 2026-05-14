// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PerfMetric = any;
type PerfEntryCallback = (metric: PerfMetric) => void;

const reportWebVitals = (onPerfEntry?: PerfEntryCallback): void => {
  if (onPerfEntry && onPerfEntry instanceof Function) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (import('web-vitals') as any).then(({ getCLS, getFID, getFCP, getLCP, getTTFB }: any) => {
      getCLS(onPerfEntry);
      getFID(onPerfEntry);
      getFCP(onPerfEntry);
      getLCP(onPerfEntry);
      getTTFB(onPerfEntry);
    });
  }
};

export default reportWebVitals;
 