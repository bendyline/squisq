const mermaidUnavailable = {
  initialize(): void {},
  async render(): Promise<never> {
    throw new Error(
      'Mermaid rendering is not included in the light standalone player. Use the /standalone/full export.',
    );
  },
};

export default mermaidUnavailable;
