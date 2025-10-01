// --- UUID Generation ---
export function generateUUID() { 
  let d = new Date().getTime();
  let d2 = (performance && performance.now && (performance.now()*1000)) || 0;
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    let r = Math.random() * 16;
    if(d > 0){
      r = (d + r)%16 | 0;
      d = Math.floor(d/16);
    } else {
      r = (d2 + r)%16 | 0;
      d2 = Math.floor(d2/16);
    }
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
}

export function generateUniqueKey(type, ...args) {
  const dateStr = new Date().toISOString().split('T')[0];

  // Commercial entries: allow multiples, add UUID
  const multiTypes = ['vente', 'production', 'deblai', 'clientPayment'];
  const uuidSuffix = multiTypes.includes(type) ? `-${generateUUID()}` : '';

  return `${type}-${dateStr}-${args.join('-')}${uuidSuffix}`;
}
