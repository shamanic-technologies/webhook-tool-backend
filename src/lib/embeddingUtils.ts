import { OpenAI } from 'openai';

/**
 * Generates an embedding for the given text using the OpenAI API.
 *
 * @param text The text to embed.
 * @param model The OpenAI embedding model to use (e.g., "text-embedding-3-small").
 * @returns A promise resolving to an array of numbers representing the embedding.
 * @throws Error if the API_KEY is not set or if the API call fails.
 */
export async function generateEmbedding(
    text: string,
    model = "text-embedding-3-small" 
): Promise<number[]> {
    // Ensure the OpenAI API key is available from environment variables
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
        console.error('OPENAI_API_KEY is not set in environment variables.');
        throw new Error('OpenAI API key is missing. Please set OPENAI_API_KEY.');
    }

    const openai = new OpenAI({ apiKey });

    try {
        // Replace newlines with spaces, as recommended by OpenAI for best performance
        const inputText = text.replace(/\n/g, ' ');

        const response = await openai.embeddings.create({
            model: model,
            input: inputText,
            // encoding_format: "float", // Optional: "float" or "base64"
        });

        if (response.data && response.data.length > 0) {
            return response.data[0].embedding;
        } else {
            // This case should ideally not happen if the API call is successful and returns data
            throw new Error('No embedding data received from OpenAI.');
        }
    } catch (error) {
        console.error('Error generating embedding from OpenAI:', error);
        // Re-throw the error or handle it more specifically
        throw new Error(`Failed to generate embedding: ${error instanceof Error ? error.message : String(error)}`);
    }
}

/**
 * Generates embeddings for a batch of texts using the OpenAI API.
 *
 * @param texts An array of texts to embed.
 * @param model The OpenAI embedding model to use (e.g., "text-embedding-3-small").
 * @returns A promise resolving to an array of embeddings (each an array of numbers).
 * @throws Error if the API_KEY is not set or if the API call fails.
 */
export async function generateEmbeddingsBatch(
    texts: string[],
    model = "text-embedding-3-small"
): Promise<number[][]> {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
        console.error('OPENAI_API_KEY is not set in environment variables.');
        throw new Error('OpenAI API key is missing. Please set OPENAI_API_KEY.');
    }

    const openai = new OpenAI({ apiKey });

    try {
        const inputTexts = texts.map(text => text.replace(/\n/g, ' '));

        const response = await openai.embeddings.create({
            model: model,
            input: inputTexts,
        });

        if (response.data && response.data.length > 0) {
            return response.data.map((item: { embedding: number[]; index: number }) => item.embedding);
        } else {
            throw new Error('No embedding data received from OpenAI for batch operation.');
        }
    } catch (error) {
        console.error('Error generating batch embeddings from OpenAI:', error);
        throw new Error(`Failed to generate batch embeddings: ${error instanceof Error ? error.message : String(error)}`);
    }
} 