const parseDate = (val: string) => {
    if (!val) return '';
    try {
      const parts = val.split('/');
      if (parts.length === 3) {
        return `${parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`;
      }
      return val;
    } catch {
      return val;
    }
}
console.log(parseDate("25/08/2025"));
