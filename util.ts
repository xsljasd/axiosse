const safeParseJSON = (jsonString: string, defaultValue: unknown = null): any => {
    const reg = new RegExp(/^[{$$].*[}$$]$/)
    if (
        !jsonString ||
        typeof jsonString !== 'string' ||
        !reg.test(jsonString)
    ) {
        return defaultValue; // Return the defaultValue if input is not a valid JSON string
    }
    try {
        return JSON.parse(jsonString);
    } catch (e) {
        console.error('Failed to parse JSON, input content:', jsonString);
        console.error('Detail of Error:', e);
        return defaultValue; // Return the defaultValue if parsing fails
    }
}