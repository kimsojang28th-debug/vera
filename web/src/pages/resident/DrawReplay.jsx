import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../../firebase';
import DrawStage from '../../components/DrawStage';

// 입주민용 추첨 다시보기. 이름은 서버에서 가린 상태로 내려옵니다.
export default function DrawReplay() {
  const { eventId } = useParams();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const getDrawReplay = httpsCallable(functions, 'getDrawReplay');
        const result = await getDrawReplay({ eventId });
        setData(result.data);
      } catch (err) {
        setError(err.message?.replace(/^\S+:\s*/, '') || '추첨 결과를 불러오지 못했습니다.');
      }
    })();
  }, [eventId]);

  return (
    <div className="draw-replay">
      <button className="link-button back-link" onClick={() => navigate(`/events/${eventId}`)}>← 행사로 돌아가기</button>
      {error && <p className="empty-state">{error}</p>}
      {!error && !data && <div className="page-loading">불러오는 중...</div>}
      {data && (
        <DrawStage data={data} mode="replay" autoDefault>
          <Link className="stage-cta stage-cta-outline" to={`/events/${eventId}/draw/report`}>
            추첨 결과 확인서
          </Link>
        </DrawStage>
      )}
    </div>
  );
}
