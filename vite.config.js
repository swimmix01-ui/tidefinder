import { defineConfig } from 'vite';

export default defineConfig({
  // Netlify에 배포할 때 루트 경로 기준으로 자산을 참조하도록 설정
  base: '/',

  build: {
    outDir: 'dist',
    // 소스맵을 켜두면 배포 후에도 브라우저 개발자도구에서 원본 파일명·줄번호로
    // 에러가 표시된다. 통신 불안정 현장에서 문제가 생겼을 때 원인 파악이
    // 훨씬 빨라지므로, 번들 용량이 조금 늘더라도 켜두는 쪽을 권장한다.
    sourcemap: true,
  },

  server: {
    port: 5173,
    // 로컬 개발 중 /.netlify/functions/* 요청을 실제 배포된 함수로 우회시킨다.
    // (netlify dev를 따로 안 쓰고 vite만으로 개발할 때 유용 - 필요 없으면 지워도 됨)
    proxy: {
      '/.netlify/functions': {
        target: 'https://magical-ganache-c5c79f.netlify.app',
        changeOrigin: true,
      },
    },
  },
});
