const parseNumber = (val: string) => {
  if (!val) return 0;
  const clean = val.replace(/\./g, '').replace(',', '.');
  return parseFloat(clean) || 0;
};
console.log(parseNumber("1.234,56"));
console.log(parseNumber("1234"));
