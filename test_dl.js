async function downloadYoutubeAudio(ytUrl) {
  try {
    const apiUrl = `https://api-olive-five-53.vercel.app/download?url=${encodeURIComponent(ytUrl)}`;
    const res = await fetch(apiUrl);
    const data = await res.json();
    
    if (!data.audio) {
      console.log("No audio found in response");
      return null;
    }
    
    const audioUrl = data.audio["320"] || Object.values(data.audio).find(v => typeof v === 'string');
    if (!audioUrl) return null;

    console.log("Audio URL:", audioUrl);
    
    const audioRes = await fetch(audioUrl);
    const arrayBuffer = await audioRes.arrayBuffer();
    return Buffer.from(arrayBuffer);
  } catch (e) {
    console.error("dl err:", e);
    return null;
  }
}
downloadYoutubeAudio('https://www.youtube.com/watch?v=dQw4w9WgXcQ').then(b => console.log(b ? b.length : 0));
