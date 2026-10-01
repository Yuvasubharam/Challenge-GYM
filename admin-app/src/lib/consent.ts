// Risk-acceptance consent shown at the desk after a member joins.
// NEVER edit the text of a version that has been signed: add a new version instead (and add it to
// CONSENT_VERSIONS in server/src/lib/consent.ts), so every stored signature keeps pointing at the
// exact words the member agreed to.
export type ConsentLang = 'en' | 'te' | 'hi';
export const CURRENT_CONSENT = '2026-09-v1';

export const CONSENT_LANG_LABEL: Record<ConsentLang, string> = { en: 'English', te: 'తెలుగు (Telugu)', hi: 'हिन्दी (Hindi)' };

interface ConsentText { title: string; intro: (name: string) => string; points: string[]; agree: string; signHere: string }

export const CONSENT: Record<string, Record<ConsentLang, ConsentText>> = {
  '2026-09-v1': {
    en: {
      title: 'Declaration of risk and release',
      intro: (name) => `I, ${name}, declare that:`,
      points: [
        'I am joining Challenge Gym of my own free will and I am physically fit to exercise. I have told the gym about any illness, injury, surgery or medical condition I have (heart problems, BP, diabetes, asthma, pregnancy, etc.), and I will consult a doctor before training where needed.',
        'I understand that exercise, weights and machines carry a risk of injury, and I take part entirely at my own risk.',
        'I will follow the trainers’ instructions and the gym rules, use the equipment properly, and stop immediately and inform the staff if I feel unwell.',
        'Challenge Gym, its owners, trainers and staff will not be responsible for any injury, illness, loss or damage that happens to me in the gym or during training, except where it is caused by their proven negligence.',
        'The gym is not responsible for the loss or theft of my belongings.',
        'In an emergency, I allow the gym to arrange first aid and medical help at my cost and to contact my emergency contact.',
        'I have read this declaration in the language I chose (or had it read to me), I understand it, and I sign it willingly.',
      ],
      agree: 'I have read and agree to the above',
      signHere: 'Sign here',
    },
    te: {
      title: 'ప్రమాద అంగీకారం మరియు బాధ్యత విడుదల ప్రకటన',
      intro: (name) => `నేను, ${name}, ఈ క్రింది విధంగా ప్రకటిస్తున్నాను:`,
      points: [
        'నేను నా స్వంత ఇష్టంతో ఛాలెంజ్ జిమ్‌లో చేరుతున్నాను మరియు వ్యాయామం చేయడానికి శారీరకంగా ఆరోగ్యంగా ఉన్నాను. నాకు ఉన్న ఏదైనా అనారోగ్యం, గాయం, శస్త్రచికిత్స లేదా వైద్య పరిస్థితి (గుండె సమస్యలు, బీపీ, షుగర్, ఆస్తమా, గర్భం మొదలైనవి) గురించి జిమ్‌కు తెలియజేశాను, అవసరమైతే శిక్షణకు ముందు డాక్టర్‌ను సంప్రదిస్తాను.',
        'వ్యాయామం, బరువులు మరియు యంత్రాల వాడకంలో గాయాలయ్యే ప్రమాదం ఉందని నేను అర్థం చేసుకున్నాను, మరియు పూర్తిగా నా స్వంత బాధ్యతపై పాల్గొంటున్నాను.',
        'నేను ట్రైనర్ల సూచనలను మరియు జిమ్ నియమాలను పాటిస్తాను, పరికరాలను సరిగ్గా ఉపయోగిస్తాను, అస్వస్థతగా అనిపిస్తే వెంటనే ఆపి సిబ్బందికి తెలియజేస్తాను.',
        'జిమ్‌లో లేదా శిక్షణ సమయంలో నాకు జరిగే ఏ గాయం, అనారోగ్యం, నష్టం లేదా హానికి ఛాలెంజ్ జిమ్, దాని యజమానులు, ట్రైనర్లు మరియు సిబ్బంది బాధ్యులు కారు — వారి నిర్లక్ష్యం వల్ల జరిగినట్లు రుజువైతే తప్ప.',
        'నా వస్తువులు పోయినా లేదా దొంగిలించబడినా జిమ్ బాధ్యత వహించదు.',
        'అత్యవసర పరిస్థితిలో, నా ఖర్చుతో ప్రథమ చికిత్స మరియు వైద్య సహాయం ఏర్పాటు చేయడానికి మరియు నా అత్యవసర సంప్రదింపు వ్యక్తిని సంప్రదించడానికి జిమ్‌కు అనుమతి ఇస్తున్నాను.',
        'నేను ఎంచుకున్న భాషలో ఈ ప్రకటనను చదివాను (లేదా నాకు చదివి వినిపించారు), అర్థం చేసుకున్నాను, మరియు ఇష్టపూర్వకంగా సంతకం చేస్తున్నాను.',
      ],
      agree: 'పై విషయాలను చదివి అంగీకరిస్తున్నాను',
      signHere: 'ఇక్కడ సంతకం చేయండి',
    },
    hi: {
      title: 'जोखिम स्वीकृति एवं दायित्व मुक्ति घोषणा',
      intro: (name) => `मैं, ${name}, घोषणा करता/करती हूँ कि:`,
      points: [
        'मैं अपनी इच्छा से चैलेंज जिम में शामिल हो रहा/रही हूँ और व्यायाम करने के लिए शारीरिक रूप से स्वस्थ हूँ। मैंने अपनी किसी भी बीमारी, चोट, सर्जरी या चिकित्सा स्थिति (हृदय रोग, बीपी, शुगर, अस्थमा, गर्भावस्था आदि) के बारे में जिम को बता दिया है, और आवश्यकता होने पर प्रशिक्षण से पहले डॉक्टर से सलाह लूँगा/लूँगी।',
        'मैं समझता/समझती हूँ कि व्यायाम, वज़न और मशीनों के उपयोग में चोट लगने का जोखिम है, और मैं पूरी तरह अपने जोखिम पर इसमें भाग ले रहा/रही हूँ।',
        'मैं ट्रेनरों के निर्देशों और जिम के नियमों का पालन करूँगा/करूँगी, उपकरणों का सही उपयोग करूँगा/करूँगी, और अस्वस्थ महसूस होने पर तुरंत रुककर स्टाफ़ को बताऊँगा/बताऊँगी।',
        'जिम में या प्रशिक्षण के दौरान मुझे होने वाली किसी भी चोट, बीमारी, हानि या नुकसान के लिए चैलेंज जिम, उसके मालिक, ट्रेनर और स्टाफ़ ज़िम्मेदार नहीं होंगे — सिवाय उस स्थिति के जब यह उनकी सिद्ध लापरवाही से हुआ हो।',
        'मेरे सामान के खोने या चोरी होने के लिए जिम ज़िम्मेदार नहीं है।',
        'आपात स्थिति में, मैं जिम को अपने खर्च पर प्राथमिक उपचार और चिकित्सा सहायता की व्यवस्था करने तथा मेरे आपातकालीन संपर्क व्यक्ति से संपर्क करने की अनुमति देता/देती हूँ।',
        'मैंने अपनी चुनी हुई भाषा में यह घोषणा पढ़ ली है (या मुझे पढ़कर सुनाई गई है), इसे समझ लिया है और स्वेच्छा से हस्ताक्षर कर रहा/रही हूँ।',
      ],
      agree: 'मैंने उपरोक्त पढ़ लिया है और मैं सहमत हूँ',
      signHere: 'यहाँ हस्ताक्षर करें',
    },
  },
};
