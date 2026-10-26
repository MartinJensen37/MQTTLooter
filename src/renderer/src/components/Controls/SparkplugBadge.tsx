/** Yellow marker on Sparkplug B topics, messages and tools. */
export default function SparkplugBadge({
  title = 'Sparkplug B 3.0 (spBv1.0 topic namespace)',
}: {
  title?: string;
}) {
  return (
    <span className="spb-badge" title={title}>
      SpB v3.0
    </span>
  );
}
