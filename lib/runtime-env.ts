type LearnCraftRuntimeEnvironment = {
  OPENAI_API_KEY?: string;
  OPENAI_MODEL?: string;
};

export function getRuntimeEnvironmentValue(
  name: keyof LearnCraftRuntimeEnvironment,
) {
  return process.env[name];
}
