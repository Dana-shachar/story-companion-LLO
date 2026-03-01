import { loadEnv } from 'vite'

export default function({ mode }) {
  const env = loadEnv(mode, process.cwd(), '')
  return {
    define: {
      API_KEY: JSON.stringify(env.VITE_API_KEY)
    },
    server: {
      proxy: {
        '/api/openai': {
          target: 'https://share.aap.cornell.edu',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api\/openai/, '/apps/oaigw/gw.pl')
        }
      }
    }
  }
}
