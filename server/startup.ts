export function terminalHyperlinksSupported(environment:NodeJS.ProcessEnv=process.env){
  if(environment.FORCE_HYPERLINK==='0'||environment.TERM==='dumb')return false;
  if(environment.FORCE_HYPERLINK==='1')return true;
  return environment.TERM_PROGRAM!==undefined||environment.WT_SESSION!==undefined||environment.TERM?.includes('color')===true||environment.COLORTERM!==undefined;
}

/** The visible text remains the complete URL, so unsupported terminals still show a usable fallback. */
export function terminalUrl(url:string,environment:NodeJS.ProcessEnv=process.env){return terminalHyperlinksSupported(environment)?`\u001B]8;;${url}\u0007${url}\u001B]8;;\u0007`:url;}

export function startupLines(port:number,environment:NodeJS.ProcessEnv=process.env){
  const appUrl=(environment.FOLIO_APP_URL||'http://127.0.0.1:5173').replace(/\/$/,'');
  return [
    `Folio API listening on ${terminalUrl(`http://127.0.0.1:${port}`,environment)}`,
    `Versicherungsportal: ${terminalUrl(`${appUrl}/portal`,environment)}`,
    `Teststudio: ${terminalUrl(`${appUrl}/testing`,environment)}`,
    `Chat-Arbeitsplatz: ${terminalUrl(`${appUrl}/testing/chat`,environment)}`,
  ];
}
