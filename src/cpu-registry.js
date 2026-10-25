import { validateArchitecture } from './ui/architecture.js';
/** Registry is populated by backend/server.py scanning cpus/<folder>/. */
export async function discoverCpus() {
  const response = await fetch('/api/cpus', {cache:'no-store'});
  if (!response.ok) throw new Error(`CPU registry HTTP ${response.status}; start with start.bat/start.sh`);
  const data = await response.json();
  if (!Array.isArray(data.cpus) || !data.cpus.length) throw new Error('No valid CPU plugins in cpus/');
  const result = new Map();
  for (const m of data.cpus) {
    if (!/^[a-zA-Z0-9_-]+$/.test(m.id) || result.has(m.id)) throw new Error('Invalid or duplicate CPU plugin ID');
    const base = `/cpus/${m.id}`;
    const [archResponse, module] = await Promise.all([
      fetch(`${base}/architecture.json`,{cache:'no-store'}),
      import(`${base}/adapter.js`)
    ]);
    if (!archResponse.ok || typeof module.createCpu !== 'function') throw new Error(`CPU ${m.id}: missing architecture or createCpu()`);
    const architecture = validateArchitecture(await archResponse.json());
    const cpu = module.createCpu({id:m.id,manifest:m,architecture});
    for (const method of ['load','reset','step','snapshot','runToEnd']) {
      if (typeof cpu?.[method] !== 'function') throw new Error(`CPU ${m.id}: missing ${method}()`);
    }
    result.set(m.id,{...m,architecture,cpu});
  }
  return result;
}
